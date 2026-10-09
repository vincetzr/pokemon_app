import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
const rules = createRequire(import.meta.url)('../../../scripts/scanner-rules.cjs');
const now = Date.parse('2026-10-09T00:00:00Z');
const card = { id: 'x', name: 'Pikachu', number: '58', setName: 'Base', language: 'English', variants: ['normal'] };
const q = { variant: 'Normal', amount: 10, currency: 'USD', condition: 'unspecified', basis: 'market' };
const data = { schema: 1, asOf: '2026-10-08T20:00:00Z', cards: { x: { ...card, productId: 1, quotes: [q] } } };
const candidates = [{ card, score: 0.95, probability: 0.99 }, { card: { ...card, id: 'y' }, score: 0.80 }];
describe('standalone price and identity safeguards', () => {
  it('requires absolute separation even with a 99% softmax share', () => {
    expect(rules.confidentPick([{ score: 0.9, probability: 0.99 }, { score: 0.89 }])).toBe(false);
    expect(rules.confidentPick(candidates)).toBe(true);
    expect(rules.confidentPick([])).toBe(false);
    expect(rules.confidentPick([{ score: NaN, probability: 1 }])).toBe(false);
  });
  it('does not price multiple printings until one is selected', () => {
    const multiple = { ...data, cards: { x: { ...data.cards.x, quotes: [q, { ...q, variant: 'Reverse Holofoil', amount: 99 }] } } };
    expect(rules.selectedQuote(card, multiple, undefined, now)).toBeNull();
    expect(rules.selectedQuote(card, multiple, 'normal', now).amount).toBe(10);
    expect(rules.selectedQuote({ ...card, variants: ['normal', 'reverseHolofoil'] }, data, undefined, now)).toBeNull();
  });
  it('validates identity and date instead of trusting a matching ID alone', () => {
    expect(rules.selectedQuote({ ...card, language: 'Japanese' }, data, undefined, now)).toBeNull();
    expect(rules.selectedQuote({ ...card, number: '59' }, data, undefined, now)).toBeNull();
    expect(rules.selectedQuote(card, { ...data, asOf: '2027-01-01' }, undefined, now)).toBeNull();
  });
  it('excludes weak matches, unusable photos and stale quotes from bulk totals', () => {
    expect(rules.bulkValue(card, data, candidates, {}, now)?.amount).toBe(10);
    expect(rules.bulkValue(card, data, candidates, { tooBlurry: true }, now)).toBeNull();
    expect(rules.bulkValue(card, data, candidates, {}, now + 3 * 86400000)).toBeNull();
    expect(rules.bulkValue(card, data, [{ score: 0.7, probability: 1 }], {}, now)).toBeNull();
  });
});
