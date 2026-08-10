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
import type { Condition, Money, PriceQuote, PrintVariant } from '../types';

const NM: Condition = { kind: 'raw', condition: 'NM' };

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
 * that printing, and it corresponds to Near Mint. `low`/`mid`/`high` describe
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
      condition: NM,
      price: usd(prices.market),
      provenance: 'observed',
      source: 'tcgplayer',
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
      condition: NM,
      price: eur(trend),
      provenance: 'observed',
      source: 'cardmarket',
      asOf,
    });
  } else if (isUsable(sell)) {
    out.push({
      cardId,
      variant,
      condition: NM,
      price: eur(sell),
      provenance: 'observed',
      source: 'cardmarket',
      asOf,
    });
  }

  // Excellent-or-better lowest ask. Cardmarket's EX sits between TCGplayer's LP
  // and MP; we record it against LP as the closest rung and say so in the label.
  if (!isReverse && isUsable(prices.lowPriceExPlus)) {
    out.push({
      cardId,
      variant,
      condition: { kind: 'raw', condition: 'LP' },
      price: eur(prices.lowPriceExPlus),
      provenance: 'observed',
      source: 'cardmarket',
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

  const tcgDate = parseApiDate(raw.tcgplayer?.updatedAt) ?? today();
  for (const [variant, prices] of Object.entries(raw.tcgplayer?.prices ?? {})) {
    if (!prices) continue;
    quotes.push(...quotesFromTcgPlayer(raw.id, variant as PrintVariant, prices, tcgDate));
  }

  const cmDate = parseApiDate(raw.cardmarket?.updatedAt) ?? today();
  const cmPrices = raw.cardmarket?.prices;
  if (cmPrices) {
    // Cardmarket does not break its main fields out by printing, so attribute
    // them to the card's primary variant, plus reverse holo when that exists.
    const variants = Object.keys(raw.tcgplayer?.prices ?? {}) as PrintVariant[];
    const primary = variants.find((v) => v !== 'reverseHolofoil') ?? variants[0] ?? 'normal';
    quotes.push(...quotesFromCardmarket(raw.id, primary, cmPrices, cmDate));

    if (variants.includes('reverseHolofoil')) {
      quotes.push(...quotesFromCardmarket(raw.id, 'reverseHolofoil', cmPrices, cmDate));
    }
  }

  return quotes;
}

/** All listing spreads for a card. */
export function spreadsForCard(raw: RawCard): ListingSpread[] {
  const asOf = parseApiDate(raw.tcgplayer?.updatedAt) ?? today();
  return Object.entries(raw.tcgplayer?.prices ?? {})
    .filter((entry): entry is [string, RawTcgPlayerPrices] => Boolean(entry[1]))
    .map(([variant, prices]) => spreadFromTcgPlayer(variant as PrintVariant, prices, asOf));
}

/**
 * Pick the quote to headline and to rank bulk scans by.
 *
 * Preference order: an observed USD Near Mint market price, then observed EUR,
 * then anything real. A modeled figure is only ever chosen if nothing real
 * exists, and the caller can tell because `provenance` says so.
 */
export function headlineQuote(quotes: PriceQuote[]): PriceQuote | null {
  if (quotes.length === 0) return null;

  const rank = (q: PriceQuote): number => {
    let score = 0;
    if (q.provenance === 'observed' || q.provenance === 'recorded') score += 100;
    if (q.provenance === 'backfilled') score += 50;
    if (q.source === 'tcgplayer') score += 10;
    if (q.condition.kind === 'raw' && q.condition.condition === 'NM') score += 5;
    // Prefer the more valuable printing when a card exists in several, since
    // that is the one a user is most likely asking about.
    score += Math.min(q.price.amount / 1000, 4);
    return score;
  };

  return [...quotes].sort((a, b) => rank(b) - rank(a))[0] ?? null;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
