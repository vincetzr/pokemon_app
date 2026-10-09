import { describe, expect, it } from 'vitest';
import { gradedComparableAmount, type GradedItem } from './graded';
import type { Card } from '../types';
const card = { id: 'base1-4', name: 'Charizard', number: '4', set: { name: 'Base' } } as Card;
const item: GradedItem = { conditionId: '2750', price: { value: '250', currency: 'USD' }, itemWebUrl: 'https://www.ebay.com/itm/1234567890', title: 'Charizard PSA 8', buyingOptions: ['FIXED_PRICE'], localizedAspects: [{ name: 'Card Name', value: 'Charizard' }, { name: 'Card Number', value: '004/102' }, { name: 'Set', value: 'Base' }, { name: 'Language', value: 'English' }, { name: 'Finish', value: 'Holofoil' }], conditionDescriptors: [{ name: 'Professional Grader', values: [{ content: 'Professional Sports Authenticator (PSA)' }] }, { name: 'Grade', values: [{ content: '8' }] }] };
describe('exact graded asking comparables', () => {
  const graded = { company: 'PSA' as const, grade: 8 };
  it('accepts explicit identity and structured grade', () => { expect(gradedComparableAmount(item, card, 'holofoil', graded)).toBe(250); });
  it('rejects a title-only match, wrong company and wrong grade', () => {
    expect(gradedComparableAmount({ ...item, localizedAspects: [] }, card, 'holofoil', graded)).toBe(null);
    expect(gradedComparableAmount(item, card, 'holofoil', { company: 'BGS', grade: 8 })).toBe(null);
    expect(gradedComparableAmount({ ...item, conditionDescriptors: [{ name: 'Professional Grader', values: [{ content: 'Beckett Collectors Club Grading (BCCG)' }] }, { name: 'Grade', values: [{ content: '8' }] }] }, card, 'holofoil', { company: 'BGS', grade: 8 })).toBe(null);
    expect(gradedComparableAmount(item, card, 'holofoil', { company: 'PSA', grade: 9 })).toBe(null);
  });
  it('rejects language, printing, rare edition and designation mismatches', () => {
    expect(gradedComparableAmount({ ...item, localizedAspects: item.localizedAspects!.map(a => a.name === 'Language' ? { ...a, value: 'Japanese' } : a) }, card, 'holofoil', graded)).toBe(null);
    expect(gradedComparableAmount(item, card, 'reverseHolofoil', graded)).toBe(null);
    expect(gradedComparableAmount({ ...item, title: 'Charizard 1st Edition PSA 8' }, card, 'holofoil', graded)).toBe(null);
    expect(gradedComparableAmount({ ...item, title: 'Charizard PSA 8 OC' }, card, 'holofoil', graded)).toBe(null);
  });
  it('rejects out-of-stock offers, foreign currency and invalid amounts', () => {
    expect(gradedComparableAmount({ ...item, estimatedAvailabilities: [{ estimatedAvailabilityStatus: 'OUT_OF_STOCK' }] }, card, 'holofoil', graded)).toBe(null);
    expect(gradedComparableAmount({ ...item, price: { value: '250', currency: 'EUR' } }, card, 'holofoil', graded)).toBe(null);
    expect(gradedComparableAmount({ ...item, price: { value: 'NaN', currency: 'USD' } }, card, 'holofoil', graded)).toBe(null);
  });
});
