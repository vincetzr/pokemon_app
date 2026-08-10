import { describe, expect, it } from 'vitest';
import { headlineQuote, quotesForCard, spreadsForCard } from './quotes';
import { seedFromCardmarket, mergePoints, seriesStats } from './history';
import type { RawCard } from '../tcg-api';
import type { PricePoint, PriceQuote, PriceSeries } from '../types';

/** A card shaped like a real API response, with the fields under test. */
function card(overrides: Partial<RawCard> = {}): RawCard {
  return {
    id: 'base1-4',
    name: 'Charizard',
    number: '4',
    rarity: 'Rare Holo',
    images: { small: '', large: '' },
    set: {
      id: 'base1',
      name: 'Base',
      series: 'Base',
      printedTotal: 102,
      total: 102,
      releaseDate: '1999/01/09',
      images: { symbol: '', logo: '' },
    },
    tcgplayer: {
      url: '',
      updatedAt: '2026/08/08',
      prices: {
        holofoil: { low: 475, mid: 899.5, high: 4590.63, market: 818.65, directLow: 612.06 },
      },
    },
    cardmarket: {
      url: '',
      updatedAt: '2026/07/01',
      prices: {
        averageSellPrice: 1531,
        lowPrice: 799,
        trendPrice: 4184.6,
        germanProLow: 0,
        suggestedPrice: 0,
        reverseHoloSell: 0,
        reverseHoloLow: 0,
        reverseHoloTrend: 0,
        lowPriceExPlus: 1750,
        avg1: 14950,
        avg7: 3939.88,
        avg30: 2427.79,
        reverseHoloAvg1: 0,
        reverseHoloAvg7: 0,
        reverseHoloAvg30: 0,
      },
    },
    ...overrides,
  } as RawCard;
}

describe('quotesForCard', () => {
  it('keeps TCGplayer in USD and Cardmarket in EUR', () => {
    const quotes = quotesForCard(card());

    for (const q of quotes) {
      if (q.source === 'tcgplayer') expect(q.price.currency).toBe('USD');
      if (q.source === 'cardmarket') expect(q.price.currency).toBe('EUR');
    }
  });

  it('marks every marketplace figure as observed, never modeled', () => {
    for (const q of quotesForCard(card())) {
      expect(q.provenance).toBe('observed');
    }
  });

  it('surfaces the Cardmarket Excellent-or-better price as a real condition quote', () => {
    // lowPriceExPlus is a genuine condition-segmented observation, not an
    // estimate — it must not be dropped or relabelled as modeled.
    const lp = quotesForCard(card()).find(
      (q) => q.source === 'cardmarket' && q.condition.kind === 'raw' && q.condition.condition === 'LP',
    );

    expect(lp).toBeDefined();
    expect(lp!.price.amount).toBe(1750);
    expect(lp!.provenance).toBe('observed');
  });

  it('uses the marketplace timestamp, not today', () => {
    const tcg = quotesForCard(card()).find((q) => q.source === 'tcgplayer');
    expect(tcg!.asOf).toBe('2026-08-08');
  });

  it('ignores zero and missing prices rather than recording them as free', () => {
    const quotes = quotesForCard(
      card({
        tcgplayer: {
          url: '',
          updatedAt: '2026/08/08',
          prices: { holofoil: { low: 0, mid: null, high: null, market: 0, directLow: null } },
        },
      } as Partial<RawCard>),
    );
    expect(quotes.every((q) => q.price.amount > 0)).toBe(true);
  });

  it('handles a card with no pricing at all', () => {
    const quotes = quotesForCard(card({ tcgplayer: undefined, cardmarket: undefined }));
    expect(quotes).toEqual([]);
  });
});

describe('spreadsForCard', () => {
  it('reports the listing spread separately from condition quotes', () => {
    const [spread] = spreadsForCard(card());
    expect(spread!.low?.amount).toBe(475);
    expect(spread!.high?.amount).toBe(4590.63);
    expect(spread!.low?.currency).toBe('USD');
  });
});

describe('headlineQuote', () => {
  const quote = (partial: Partial<PriceQuote>): PriceQuote =>
    ({
      cardId: 'x',
      variant: 'holofoil',
      condition: { kind: 'raw', condition: 'NM' },
      price: { amount: 10, currency: 'USD' },
      provenance: 'observed',
      source: 'tcgplayer',
      asOf: '2026-08-08',
      ...partial,
    }) as PriceQuote;

  it('prefers a real quote over a modeled one, even a larger modeled one', () => {
    const chosen = headlineQuote([
      quote({ provenance: 'modeled', price: { amount: 5000, currency: 'USD' } }),
      quote({ provenance: 'observed', price: { amount: 10, currency: 'USD' } }),
    ]);
    expect(chosen!.provenance).toBe('observed');
  });

  it('returns null when there are no quotes', () => {
    expect(headlineQuote([])).toBeNull();
  });
});

describe('seedFromCardmarket', () => {
  const prices = card().cardmarket!.prices;

  it('places each rolling average at the centroid of its window', () => {
    // avg30 summarises the trailing 30 days, so plotting it at "today" would be
    // wrong; its centre is 15 days back.
    const { points } = seedFromCardmarket(prices, '2026-07-01', 'holofoil');
    const dates = points.map((p) => p.date);

    expect(dates).toContain('2026-06-16'); // avg30 → 15 days back
    expect(dates).toContain('2026-06-27'); // avg7  → ~4 days back
    expect(dates).toContain('2026-06-30'); // avg1  → ~1 day back
  });

  it('marks the seeded points as real observations', () => {
    const { points } = seedFromCardmarket(prices, '2026-07-01', 'holofoil');
    expect(points.every((p) => p.provenance === 'observed')).toBe(true);
    expect(points.every((p) => p.price.currency === 'EUR')).toBe(true);
  });

  it('warns when the 1-day average diverges wildly, but keeps the point', () => {
    // Real data: avg1 14950 against avg7 3939 — one unusual sale dominating a
    // thin market. The point is real and stays; the user is told why.
    const { points, caveats } = seedFromCardmarket(prices, '2026-07-01', 'holofoil');
    expect(points).toHaveLength(3);
    expect(caveats.join(' ')).toMatch(/1-day average/);
  });

  it('does not warn when the averages are consistent', () => {
    const { caveats } = seedFromCardmarket(
      { ...prices, avg1: 2500, avg7: 2450, avg30: 2400 },
      '2026-07-01',
      'holofoil',
    );
    expect(caveats).toHaveLength(0);
  });

  it('uses the reverse-holo fields for a reverse-holo variant', () => {
    const { points } = seedFromCardmarket(
      { ...prices, reverseHoloAvg7: 42, reverseHoloAvg30: 40 },
      '2026-07-01',
      'reverseHolofoil',
    );
    expect(points.map((p) => p.price.amount)).toEqual([40, 42]);
  });
});

describe('mergePoints', () => {
  const point = (partial: Partial<PricePoint>): PricePoint =>
    ({
      date: '2026-07-01',
      price: { amount: 10, currency: 'EUR' },
      provenance: 'observed',
      source: 'cardmarket',
      ...partial,
    }) as PricePoint;

  it('prefers a recorded point over a derived one for the same slot', () => {
    const merged = mergePoints(
      [point({ provenance: 'observed', price: { amount: 10, currency: 'EUR' } })],
      [point({ provenance: 'recorded', price: { amount: 11, currency: 'EUR' } })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.provenance).toBe('recorded');
  });

  it('keeps points from different sources on the same date', () => {
    const merged = mergePoints(
      [point({ source: 'cardmarket' })],
      [point({ source: 'tcgplayer', price: { amount: 12, currency: 'USD' } })],
    );
    expect(merged).toHaveLength(2);
  });

  it('returns points in chronological order', () => {
    const merged = mergePoints([point({ date: '2026-07-05' }), point({ date: '2026-07-01' })]);
    expect(merged.map((p) => p.date)).toEqual(['2026-07-01', '2026-07-05']);
  });
});

describe('seriesStats', () => {
  const series = (points: PricePoint[]): PriceSeries => ({
    cardId: 'x',
    variant: 'holofoil',
    condition: { kind: 'raw', condition: 'NM' },
    points,
    allReal: points.every((p) => p.provenance !== 'modeled'),
  });

  const p = (date: string, amount: number, currency: 'USD' | 'EUR' = 'EUR'): PricePoint => ({
    date,
    price: { amount, currency },
    provenance: 'observed',
    source: 'cardmarket',
  });

  it('computes change over the real points', () => {
    const stats = seriesStats(series([p('2026-07-01', 100), p('2026-07-10', 150)]));
    expect(stats!.changePct).toBeCloseTo(50, 5);
    expect(stats!.n).toBe(2);
  });

  it('refuses to compute stats across mixed currencies', () => {
    // A percentage change computed across EUR and USD points is meaningless.
    const stats = seriesStats(series([p('2026-07-01', 100, 'EUR'), p('2026-07-10', 150, 'USD')]));
    expect(stats).toBeNull();
  });

  it('excludes modeled points from the statistics', () => {
    const stats = seriesStats(
      series([
        p('2026-07-01', 100),
        { ...p('2026-07-05', 999), provenance: 'modeled' },
        p('2026-07-10', 150),
      ]),
    );
    expect(stats!.n).toBe(2);
    expect(stats!.max).toBe(150);
  });

  it('returns null rather than a misleading figure with too little data', () => {
    expect(seriesStats(series([p('2026-07-01', 100)]))).toBeNull();
  });
});
