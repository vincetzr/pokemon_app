/**
 * Turning raw marketplace data into attributed price quotes.
 *
 * Two rules govern everything here:
 *
 *  1. Currencies are never mixed. TCGplayer reports USD, Cardmarket reports EUR.
 *     Averaging them, or silently treating one as the other, produces a number
 *     that is wrong by whatever the exchange rate happens to be. Quotes stay in
 *     their native currency and the UI groups by currency.
 *
 *  2. Only figures a marketplace actually reported are `observed`. Anything we
 *     compute ourselves — most importantly condition-adjusted prices — is
 *     `modeled`, carries its derivation, and is rendered as an estimate.
 */

import type { RawCard, RawCardmarketPrices, RawTcgPlayerPrices } from '../tcg-api';
import { parseApiDate } from '../tcg-api';
import { conditionKey, type Condition, type Money, type PriceQuote, type PrintVariant } from '../types';

const UNGRADED: Condition = { kind: 'ungraded' };

function usd(amount: number): Money {
  return { amount, currency: 'USD' };
}

function eur(amount: number): Money {
  return { amount, currency: 'EUR' };
}

function isUsable(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/**
 * TCGplayer's per-variant prices.
 *
 * `market` is the figure to trust: it is TCGplayer's computed market price for
 * that printing, across conditions; it does not establish a Near Mint price. `low`/`mid`/`high` describe
 * the spread of current listings, which mixes conditions and sellers, so they
 * are informative context but are not condition-specific quotes.
 */
export function quotesFromTcgPlayer(
  cardId: string,
  variant: PrintVariant,
  prices: RawTcgPlayerPrices,
  asOf: string,
): PriceQuote[] {
  const out: PriceQuote[] = [];

  if (isUsable(prices.market)) {
    out.push({
      cardId,
      variant,
      condition: UNGRADED,
      price: usd(prices.market),
      provenance: 'observed',
      source: 'tcgplayer',
      basis: 'market',
      asOf,
    });
  }

  return out;
}

/** The listing spread, kept separate from quotes because it is not condition-specific. */
export interface ListingSpread {
  variant: PrintVariant;
  source: 'tcgplayer';
  low: Money | null;
  mid: Money | null;
  high: Money | null;
  directLow: Money | null;
  asOf: string;
}

export function spreadFromTcgPlayer(
  variant: PrintVariant,
  prices: RawTcgPlayerPrices,
  asOf: string,
): ListingSpread {
  return {
    variant,
    source: 'tcgplayer',
    low: isUsable(prices.low) ? usd(prices.low) : null,
    mid: isUsable(prices.mid) ? usd(prices.mid) : null,
    high: isUsable(prices.high) ? usd(prices.high) : null,
    directLow: isUsable(prices.directLow) ? usd(prices.directLow) : null,
    asOf,
  };
}

/**
 * Cardmarket quotes.
 *
 * `lowPriceExPlus` is the most useful field the API exposes for our purposes:
 * the lowest asking price for a card in Excellent condition or better. That is
 * a genuine condition-segmented observation, not an estimate, so we surface it
 * as its own quote rather than folding it into a model.
 */
export function quotesFromCardmarket(
  cardId: string,
  variant: PrintVariant,
  prices: RawCardmarketPrices,
  asOf: string,
): PriceQuote[] {
  const out: PriceQuote[] = [];
  const isReverse = variant === 'reverseHolofoil';

  // Cardmarket splits reverse-holo pricing into its own set of fields.
  const trend = isReverse ? prices.reverseHoloTrend : prices.trendPrice;
  const sell = isReverse ? prices.reverseHoloSell : prices.averageSellPrice;

  if (isUsable(trend)) {
    out.push({
      cardId,
      variant,
      condition: UNGRADED,
      price: eur(trend),
      provenance: 'observed',
      source: 'cardmarket',
      basis: 'trend',
      asOf,
    });
  } else if (isUsable(sell)) {
    out.push({
      cardId,
      variant,
      condition: UNGRADED,
      price: eur(sell),
      provenance: 'observed',
      source: 'cardmarket',
      basis: 'market',
      asOf,
    });
  }

  // Keep Cardmarket's own EX+ category: this is not a TCGplayer LP quote.
  if (!isReverse && isUsable(prices.lowPriceExPlus)) {
    out.push({
      cardId,
      variant,
      condition: { kind: 'cardmarket-ex-plus' },
      price: eur(prices.lowPriceExPlus),
      provenance: 'observed',
      source: 'cardmarket',
      basis: 'asking',
      asOf,
    });
  }

  return out;
}

/**
 * Build every quote a card exposes, across all variants and both marketplaces.
 */
export function quotesForCard(raw: RawCard): PriceQuote[] {
  const quotes: PriceQuote[] = [];

  const tcgDate = parseApiDate(raw.tcgplayer?.updatedAt);
  for (const [variant, prices] of Object.entries(raw.tcgplayer?.prices ?? {})) {
    if (!prices || !tcgDate || tcgDate > new Date().toISOString().slice(0, 10)) continue;
    quotes.push(...quotesFromTcgPlayer(raw.id, variant as PrintVariant, prices, tcgDate));
  }

  const cmDate = parseApiDate(raw.cardmarket?.updatedAt);
  const cmPrices = raw.cardmarket?.prices;
  if (cmPrices && cmDate && cmDate <= new Date().toISOString().slice(0, 10)) {
    // Cardmarket does not break its main fields out by printing, so attribute
    // them to the card's primary variant, plus reverse holo when that exists.
    const variants = Object.keys(raw.tcgplayer?.prices ?? {}) as PrintVariant[];
    const primary = variants.filter((v) => v !== 'reverseHolofoil');
    // This aggregate does not distinguish editions.
    if (primary.length === 1) quotes.push(...quotesFromCardmarket(raw.id, primary[0]!, cmPrices, cmDate));

    if (variants.includes('reverseHolofoil')) {
      quotes.push(...quotesFromCardmarket(raw.id, 'reverseHolofoil', cmPrices, cmDate));
    }
  }

  return quotes;
}

/** All listing spreads for a card. */
export function spreadsForCard(raw: RawCard): ListingSpread[] {
  const asOf = parseApiDate(raw.tcgplayer?.updatedAt);
  if (!asOf || asOf > new Date().toISOString().slice(0, 10)) return [];
  return Object.entries(raw.tcgplayer?.prices ?? {})
    .filter((entry): entry is [string, RawTcgPlayerPrices] => Boolean(entry[1]))
    .map(([variant, prices]) => spreadFromTcgPlayer(variant as PrintVariant, prices, asOf));
}

/** Select a real quote only after the printing is unambiguous. */
export function headlineQuote(
  quotes: PriceQuote[],
  selection: { variant?: PrintVariant; condition?: Condition } = {},
): PriceQuote | null {
  const matching = quotes.filter((q) =>
    q.provenance !== 'modeled' && Number.isFinite(q.price.amount) && q.price.amount > 0 &&
    (!selection.variant || q.variant === selection.variant) &&
    (!selection.condition || conditionKey(q.condition) === conditionKey(selection.condition)),
  );
  if (new Set(matching.map((q) => q.variant)).size !== 1) return null;
  const rank = (q: PriceQuote) =>
    (q.provenance === 'observed' || q.provenance === 'recorded' ? 100 : 50) +
    (q.source === 'tcgplayer' ? 10 : 0) + (q.basis !== 'asking' ? 2 : 0);
  return matching.sort((a, b) => rank(b) - rank(a) || b.asOf.localeCompare(a.asOf))[0] ?? null;
}
