import { describe, it, expect } from 'vitest';
import { matchGroup, matchProduct } from './catalogue';
import { matchingAmounts, medianAmount } from './listing-sample';
import { headlineQuote, quotesForCard, spreadsForCard } from './quotes';
import { snapshotQuotes, type MarketSnapshot } from './market-snapshot';
import { holdingPrice } from './holding-price';
import type { Card, PriceQuote } from '../types';
import type { RawCard } from '../tcg-api';
import type { ConditionPricing } from './sources/tcgplayer-listings';

const card = { id: 'base1-4', name: 'Charizard', number: '4', set: { name: 'Base', printedTotal: 102, releaseDate: '1999/01/09' } } as Card;
const product = { productId: 42382, name: 'Charizard', extendedData: [{ name: 'Number', value: '004/102' }] };
const quote = (variant = 'normal', amount = 2): PriceQuote => ({ cardId: 'x', variant: variant as PriceQuote['variant'], condition: { kind: 'ungraded' },
  price: { amount, currency: 'USD' }, source: 'tcgplayer', provenance: 'observed', basis: 'market', asOf: '2026-10-08' });
const raw = { ...card, tcgplayer: { updatedAt: '2026/10/08', prices: { normal: { market: 2 }, reverseHolofoil: { market: 99 } } } } as unknown as RawCard;

describe('exact catalogue identity', () => {
  it('does not treat an unrelated group with the same date as the right set', () => {
    expect(matchGroup(card, [{ groupId: 9, name: 'Base Set (Shadowless)', publishedOn: '1999-01-09' }])).toBeNull();
    expect(matchGroup(card, [{ groupId: 604, name: 'Base Set' }])).toBe(604);
  });
  it('matches era prefixes but not a different set', () => {
    const c = { ...card, set: { ...card.set, name: 'Silver Tempest' } };
    expect(matchGroup(c, [{ groupId: 3170, name: 'SWSH12: Silver Tempest' }])).toBe(3170);
  });
  it('requires a unique matching name and collector number including denominator', () => {
    expect(matchProduct(card, [product])).toBe(42382);
    expect(matchProduct(card, [{ ...product, name: 'Charizard - 004/102' }])).toBe(42382);
    expect(matchProduct(card, [{ ...product, name: 'Charizard (Shadowless)' }])).toBeNull();
    expect(matchProduct(card, [{ ...product, name: 'Blastoise' }])).toBeNull();
    expect(matchProduct(card, [{ ...product, extendedData: [{ name: 'Number', value: '004/130' }] }])).toBeNull();
    expect(matchProduct(card, [product, { ...product, productId: 99 }])).toBeNull();
  });
});
describe('listing samples', () => {
  it('rejects wrong printing, language, condition, missing filters and invalid prices', () => {
    const good = { price: 10, condition: 'Near Mint', printing: 'Holofoil', language: 'English' };
    const rows = [good, { ...good, language: 'Japanese' }, { ...good, condition: 'Damaged' },
      { ...good, printing: '1st Edition Holofoil' }, { ...good, language: undefined }, { ...good, price: Infinity }];
    expect(matchingAmounts(rows, 'Near Mint', 'Holofoil', 'English')).toEqual([10]);
  });
  it('averages the two middle values for even samples', () => {
    expect(medianAmount([1, 2, 8, 100])).toBe(5);
    expect(medianAmount([1, 2, 100])).toBe(2);
  });
});
describe('quote selection', () => {
  it('never picks the expensive printing automatically', () => {
    expect(headlineQuote([quote(), quote('reverseHolofoil', 99)])).toBeNull();
    expect(headlineQuote([quote(), quote('reverseHolofoil', 99)], { variant: 'normal' })?.price.amount).toBe(2);
    expect(headlineQuote([quote()], { variant: 'holofoil' })).toBeNull();
  });
  it('never substitutes a modeled value', () => {
    expect(headlineQuote([{ ...quote(), provenance: 'modeled' }])).toBeNull();
  });
  it('keeps aggregates ungraded and refuses undated quotes/spreads', () => {
    expect(quotesForCard(raw).every(q => q.condition.kind === 'ungraded')).toBe(true);
    const undated = { ...raw, tcgplayer: { ...raw.tcgplayer!, updatedAt: '' } };
    expect(quotesForCard(undated)).toEqual([]);
    expect(spreadsForCard(undated)).toEqual([]);
  });
  it('does not assign Cardmarket aggregates to an arbitrary edition', () => {
    const multiple = { ...raw, tcgplayer: { ...raw.tcgplayer!, prices: { '1stEdition': { market: 20 }, unlimited: { market: 2 } } },
      cardmarket: { updatedAt: '2026/10/08', prices: { trendPrice: 50 } } } as RawCard;
    expect(quotesForCard(multiple).some(q => q.source === 'cardmarket')).toBe(false);
  });
});
describe('verified daily snapshot', () => {
  const snapshot: MarketSnapshot = { schema: 1, asOf: '2026-10-08T20:05:18Z', cards: {
    [card.id]: { name: card.name, number: card.number, setName: card.set.name, language: 'English',
      quotes: [{ variant: 'Holofoil', amount: 900, currency: 'USD', basis: 'market', condition: 'unspecified' }] },
  } };
  it('preserves the printing, date and unspecified condition', () => {
    const q = snapshotQuotes(raw, snapshot, Date.parse('2026-10-09'))![0]!;
    expect(q).toMatchObject({ variant: 'holofoil', asOf: '2026-10-08', condition: { kind: 'ungraded' }, price: { amount: 900 } });
  });
  it('rejects future snapshots and identity mismatches', () => {
    expect(snapshotQuotes(raw, snapshot, Date.parse('2026-10-07'))).toBeNull();
    expect(snapshotQuotes({ ...raw, number: '5' }, snapshot)).toBeNull();
    expect(snapshotQuotes({ ...raw, name: 'Blastoise' }, snapshot)).toBeNull();
  });
});
describe('collection holdings', () => {
  const entry = { cardId: card.id, variant: 'holofoil' as const, conditionKey: 'raw:LP' };
  const sample: ConditionPricing = { cardId: card.id, productId: 42382, variant: 'holofoil', verifiedFilters: true, language: 'English',
    sampleLimit: 25, basis: 'asking', fetchedAt: '2026-10-08T20:00:00Z', prices: [
      { condition: 'LP', low: { amount: 200, currency: 'USD' }, median: { amount: 250, currency: 'USD' }, listingCount: 5 },
      { condition: 'NM', low: { amount: 800, currency: 'USD' }, median: { amount: 900, currency: 'USD' }, listingCount: 5 },
    ] };
  it('uses the saved condition and never replaces it with Near Mint', () => {
    expect(holdingPrice(entry, sample, Date.parse('2026-10-09'))?.amount).toBe(250);
    expect(holdingPrice({ ...entry, conditionKey: 'graded:PSA10' }, sample, Date.parse('2026-10-09'))).toBeNull();
  });
  it('excludes stale samples and other printings', () => {
    expect(holdingPrice(entry, sample, Date.parse('2026-10-10'))).toBeNull();
    expect(holdingPrice(entry, { ...sample, variant: 'normal' }, Date.parse('2026-10-09'))).toBeNull();
  });
});
