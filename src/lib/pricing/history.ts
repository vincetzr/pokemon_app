/**
 * Assembling price history.
 *
 * Three sources feed a chart, and they are never blended into one
 * undifferentiated line:
 *
 *   observed/recorded  Real prices. Cardmarket's rolling averages give us a
 *                      short real window immediately; our own daily snapshots
 *                      extend it forward for as long as the app runs.
 *   backfilled         Real historical prices from a licensed third party. No
 *                      such source is currently wired in — see PriceSource.
 *   modeled            Our own condition-adjusted estimates. Rendered as a
 *                      shaded band, never as a line, and never summarised into
 *                      a headline number.
 */

import type { RawCard, RawCardmarketPrices } from '../tcg-api';
import { parseApiDate } from '../tcg-api';
import type { Condition, PricePoint, PriceSeries, PrintVariant } from '../types';
import { readHistory } from '../db';

const NM: Condition = { kind: 'raw', condition: 'NM' };

/**
 * Cardmarket publishes avg1 / avg7 / avg30: the mean sale price over the
 * trailing 1, 7, and 30 days. These are real observations, but each describes a
 * WINDOW rather than an instant, so plotting them at "today" would be wrong.
 * We place each at the centroid of the window it summarises — avg30 fifteen
 * days back, avg7 three and a half days back, avg1 half a day back — which is
 * the honest position for a trailing mean.
 */
const WINDOW_CENTROID_DAYS = { avg1: 0.5, avg7: 3.5, avg30: 15 } as const;

function daysBefore(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - Math.round(days));
  return d.toISOString().slice(0, 10);
}

function usable(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

export interface SeedResult {
  points: PricePoint[];
  caveats: string[];
}

/**
 * Real, immediately-available history from Cardmarket's rolling averages.
 * Returns at most three points spanning the last month, in EUR.
 */
export function seedFromCardmarket(
  prices: RawCardmarketPrices,
  asOf: string,
  variant: PrintVariant,
): SeedResult {
  const isReverse = variant === 'reverseHolofoil';
  const avg1 = isReverse ? prices.reverseHoloAvg1 : prices.avg1;
  const avg7 = isReverse ? prices.reverseHoloAvg7 : prices.avg7;
  const avg30 = isReverse ? prices.reverseHoloAvg30 : prices.avg30;

  const points: PricePoint[] = [];
  const caveats: string[] = [];

  const push = (value: number, days: number) => {
    points.push({
      date: daysBefore(asOf, days),
      price: { amount: value, currency: 'EUR' },
      provenance: 'observed',
      source: 'cardmarket',
    });
  };

  if (usable(avg30)) push(avg30, WINDOW_CENTROID_DAYS.avg30);
  if (usable(avg7)) push(avg7, WINDOW_CENTROID_DAYS.avg7);
  if (usable(avg1)) push(avg1, WINDOW_CENTROID_DAYS.avg1);

  // A one-day mean over a thin market is easily dominated by a single unusual
  // sale. On expensive vintage cards avg1 routinely lands multiples away from
  // avg7. The point is real and stays on the chart, but the user is told why it
  // may look like a spike rather than being quietly deleted.
  if (usable(avg1) && usable(avg7) && (avg1 > avg7 * 2.5 || avg1 < avg7 / 2.5)) {
    caveats.push(
      `Cardmarket's 1-day average (€${avg1.toFixed(2)}) is far from its 7-day average ` +
        `(€${avg7.toFixed(2)}). A single unusual sale can dominate a one-day mean on a ` +
        `thinly traded card, so treat the most recent point with caution.`,
    );
  }

  return { points, caveats };
}

/** Merge point sets, de-duplicating by (date, source) and keeping chronological order. */
export function mergePoints(...sets: PricePoint[][]): PricePoint[] {
  const byKey = new Map<string, PricePoint>();
  for (const set of sets) {
    for (const p of set) {
      const key = `${p.date}|${p.source}|${p.price.currency}`;
      const existing = byKey.get(key);
      // Prefer a point we recorded ourselves over a derived one for the same slot.
      if (!existing || rankProvenance(p) > rankProvenance(existing)) {
        byKey.set(key, p);
      }
    }
  }
  return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function rankProvenance(p: PricePoint): number {
  switch (p.provenance) {
    case 'recorded':
      return 4;
    case 'observed':
      return 3;
    case 'backfilled':
      return 2;
    default:
      return 1;
  }
}

/**
 * Build the Near Mint series for a card: Cardmarket's real rolling window plus
 * everything this app has recorded itself. Both are real; no estimates here.
 */
export function buildRealSeries(
  raw: RawCard,
  variant: PrintVariant,
): { series: PriceSeries; caveats: string[] } {
  const caveats: string[] = [];
  const cmDate = parseApiDate(raw.cardmarket?.updatedAt) ?? new Date().toISOString().slice(0, 10);

  let seeded: PricePoint[] = [];
  if (raw.cardmarket?.prices) {
    const seed = seedFromCardmarket(raw.cardmarket.prices, cmDate, variant);
    seeded = seed.points;
    caveats.push(...seed.caveats);
  }

  // Everything the daily snapshot job has captured for this card.
  const recorded = readHistory(raw.id, variant, NM);

  const points = mergePoints(seeded, recorded);

  if (points.length < 4) {
    caveats.push(
      'Price history is still filling in. This app records real prices each day it runs, ' +
        'so the chart extends over time. Cardmarket 1/7/30-day averages provide the ' +
        'initial window.',
    );
  }

  return {
    series: {
      cardId: raw.id,
      variant,
      condition: NM,
      points,
      allReal: points.every((p) => p.provenance !== 'modeled'),
    },
    caveats,
  };
}

/** Simple derived statistics, computed only over real points in a single currency. */
export interface SeriesStats {
  currency: 'USD' | 'EUR';
  first: number;
  last: number;
  min: number;
  max: number;
  changeAbs: number;
  changePct: number;
  /** Number of real observations the stats are based on. */
  n: number;
}

/**
 * Trend statistics. Returns null rather than a misleading number when there is
 * not enough real data, or when points span multiple currencies.
 */
export function seriesStats(series: PriceSeries): SeriesStats | null {
  const real = series.points.filter((p) => p.provenance !== 'modeled');
  if (real.length < 2) return null;

  const currencies = new Set(real.map((p) => p.price.currency));
  if (currencies.size !== 1) return null;

  const values = real.map((p) => p.price.amount);
  const first = values[0]!;
  const last = values[values.length - 1]!;

  return {
    currency: real[0]!.price.currency,
    first,
    last,
    min: Math.min(...values),
    max: Math.max(...values),
    changeAbs: last - first,
    changePct: first > 0 ? ((last - first) / first) * 100 : 0,
    n: real.length,
  };
}
