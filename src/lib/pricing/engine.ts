/**
 * Assembling the complete pricing picture for a card.
 *
 * Everything real is surfaced first — observed marketplace quotes and the
 * genuine history we can reconstruct. Condition estimates are layered on top,
 * clearly marked, and are never allowed to become the headline number.
 */

import 'server-only';
import type { RawCard } from '../tcg-api';
import type { CardPricing, PriceSeries, PrintVariant } from '../types';
import { headlineQuote, quotesForCard, spreadsForCard, type ListingSpread } from './quotes';
import { buildRealSeries } from './history';
import { recordSnapshots } from '../db';

export interface PricingResult extends CardPricing {
  spreads: ListingSpread[];
}

/**
 * Build pricing for a card, and record the observed prices so history accrues.
 *
 * The snapshot write is a side effect on purpose: every time a user looks at a
 * card, that day's real prices are persisted. A collection someone actually
 * browses builds genuine history without any scheduled job running at all.
 */
export function buildPricing(raw: RawCard, opts: { record?: boolean } = {}): PricingResult {
  const quotes = quotesForCard(raw);
  const spreads = spreadsForCard(raw);
  const caveats: string[] = [];

  const variants = variantList(raw);
  const series: PriceSeries[] = [];

  for (const variant of variants) {
    const built = buildRealSeries(raw, variant);
    series.push(built.series);
    for (const caveat of built.caveats) {
      if (!caveats.includes(caveat)) caveats.push(caveat);
    }
  }

  if (opts.record !== false && quotes.length > 0) {
    recordSnapshots(
      quotes
        .filter((q) => q.provenance === 'observed')
        .map((q) => ({
          cardId: q.cardId,
          variant: q.variant,
          condition: q.condition,
          price: q.price,
          provenance: 'recorded' as const,
          source: q.source,
          asOf: q.asOf,
        })),
    );
  }

  // Currency is never mixed, so say plainly which marketplace reports what.
  const hasUsd = quotes.some((q) => q.price.currency === 'USD');
  const hasEur = quotes.some((q) => q.price.currency === 'EUR');
  if (hasUsd && hasEur) {
    caveats.push(
      'TCGplayer prices are US dollars and Cardmarket prices are euros. They are shown ' +
        'separately and never converted or averaged, because the exchange rate would make ' +
        'any combined figure wrong.',
    );
  }

  if (quotes.length === 0) {
    caveats.push(
      'No marketplace currently reports a price for this card. That is common for very ' +
        'new releases and for cards that rarely trade.',
    );
  }

  return {
    cardId: raw.id,
    quotes,
    series,
    spreads,
    headline: headlineQuote(quotes),
    caveats,
    fetchedAt: new Date().toISOString(),
  };
}

function variantList(raw: RawCard): PrintVariant[] {
  const keys = Object.keys(raw.tcgplayer?.prices ?? {}) as PrintVariant[];
  return keys.length > 0 ? keys : ['normal'];
}

/**
 * Rank cards by value for a bulk scan.
 *
 * Cards whose value is unknown sort last rather than as zero — "we could not
 * price this" and "this is worthless" are different statements, and collapsing
 * them would bury a valuable card that simply had no quote that day.
 */
export interface RankedCard {
  cardId: string;
  headline: CardPricing['headline'];
  /** Comparable figure used for sorting. Null when nothing real was available. */
  sortValue: number | null;
}

export function rankByValue(pricings: CardPricing[]): RankedCard[] {
  return pricings
    .map((p) => ({
      cardId: p.cardId,
      headline: p.headline,
      sortValue: p.headline ? p.headline.price.amount : null,
    }))
    .sort((a, b) => {
      if (a.sortValue === null && b.sortValue === null) return 0;
      if (a.sortValue === null) return 1;
      if (b.sortValue === null) return -1;
      return b.sortValue - a.sortValue;
    });
}
