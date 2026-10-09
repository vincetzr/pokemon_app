import { describe, expect, it } from 'vitest';
import { EMPTY_OBSERVATIONS, certificateFromBarcode, estimateCondition, parseSlab, validGrade, verificationUrl } from './rules';
import { conditionKey } from '../types';
import { usableRawSample, type RawAskingSample } from './condition-price';

describe('slab label and certificate parsing', () => {
  it('reads PSA without dropping leading zeroes', () => {
    const read = parseSlab('PSA\n1999 Pokemon Charizard #4\nMINT 9\nCERT: 00123456');
    expect(read).toMatchObject({ company: 'PSA', grade: 9, certNumber: '00123456', needsReview: true });
    expect(read.verificationUrl).toBe('https://www.psacard.com/cert/00123456');
  });
  it('supports half grades for PSA except 9.5', () => { expect(validGrade('PSA', 8.5)).toBe(true); expect(validGrade('PSA', 1.5)).toBe(true); expect(validGrade('PSA', 9.5)).toBe(false); expect(validGrade('BGS', 9.5)).toBe(true); });
  it('reads a grade on a separate line', () => { expect(parseSlab('BECKETT\n9.5\nGEM MINT\nSerial 0012345678').grade).toBe(9.5); });
  it('does not confuse subgrades with the overall grade', () => {
    const read = parseSlab('BECKETT\nOverall: 9.5\nCentering 10\nCorners 9.5\nEdges 10\nSurface 9.5\nAutograph 10\nSerial 12345678');
    expect(read.grade).toBe(9.5); expect(read.designation).toBe(null);
    expect(parseSlab('BECKETT\nCentering 10\nCorners 9.5\nEdges 10\nAutograph 10').grade).toBe(null);
  });
  it('keeps CGC Gem Mint and Pristine distinct', () => {
    expect(parseSlab('CGC\nPRISTINE 10\nCERT 1234567890').designation).toBe('Pristine');
    expect(parseSlab('CGC\nGEM MINT 10\nCERT 1234567890').designation).toBe('Gem Mint');
  });
  it('supports PCG lookup without inventing a deep link', () => {
    expect(parseSlab('Premier Card Grading\nGrade 8.5\nCert ABC-123456')).toMatchObject({ company: 'PCG', grade: 8.5, certNumber: 'ABC-123456', verificationUrl: 'https://pop.premiercardgrading.com/' });
  });
  it('keeps authentic-only and altered cards out of numerical graded pricing', () => {
    expect(parseSlab('PSA\nAUTHENTIC ALTERED\nAutograph 10\nCert 12345678')).toMatchObject({ grade: null, designation: 'Authentic Altered' });
  });
  it('rejects disagreeing label and QR certificate numbers', () => {
    const read = parseSlab('PSA\nMINT 9\nCert 12345678', [{ text: 'https://www.psacard.com/cert/87654321', format: 'QR_CODE' }]);
    expect(read.certNumber).toBe(null); expect(read.verificationUrl).toBe(null); expect(read.conflicts.length).toBeGreaterThan(0);
  });
  it('does not guess the company of a numeric barcode', () => {
    const barcode = { text: '00123456', format: 'CODE_128' };
    expect(certificateFromBarcode(barcode)).toBe(null);
    expect(certificateFromBarcode(barcode, 'PSA')).toEqual({ company: 'PSA', cert: '00123456' });
  });
  it('does not treat retail codes, lookalike hosts or unsafe schemes as certificates', () => {
    for (const text of ['https://psacard.com.evil.example/cert/12345678', 'https://www.psacard.com@evil.example/cert/12345678', 'http://www.psacard.com/cert/12345678', 'javascript:alert(1)']) expect(certificateFromBarcode({ text, format: 'QR_CODE' })).toBe(null);
    expect(certificateFromBarcode({ text: '123456789012', format: 'EAN_13' }, 'PSA')).toBe(null);
  });
  it('rejects multiple graders or overall grades and preserves qualifiers', () => {
    expect(parseSlab('PSA BGS\nGrade 8').conflicts.length).toBeGreaterThan(0);
    expect(parseSlab('CGC PCG\nGrade 8').conflicts.length).toBeGreaterThan(0);
    expect(parseSlab('Beckett BCCG\nMINT 10\nCert 12345678').company).toBe(null);
    expect(certificateFromBarcode({ text: 'https://www.beckett.com/grading/card-lookup?flag=2&item_id=12345678', format: 'QR_CODE' })).toBe(null);
    expect(parseSlab('PSA\nGrade 8\nOverall 9').grade).toBe(null);
    expect(parseSlab('PSA\nMINT 9 OC\nCert 12345678').designation).toBe('OC');
  });
});
describe('condition estimates cannot masquerade as certified grades', () => {
  const inspected = { ...EMPTY_OBSERVATIONS, frontUsable: true, backUsable: true, confirmed: true, corners: 'none' as const, edges: 'none' as const, surface: 'none' as const, creases: 'none' as const };
  it('requires both sides and reviewed observations', () => {
    expect(estimateCondition({ ...inspected, backUsable: false }).raw).toBe(null);
    expect(estimateCondition({ ...inspected, confirmed: false }).raw).toBe(null);
    expect(estimateCondition({ ...inspected, surface: 'unknown' }).raw).toBe(null);
  });
  it('abstains through plastic', () => { expect(estimateCondition({ ...inspected, throughHolder: true })).toMatchObject({ raw: null, gradeRanges: [] }); });
  it('does not predict perfect or black-label grades from photos', () => {
    const result = estimateCondition(inspected); expect(result.raw).toBe('NM');
    expect(result.gradeRanges.every(r => r.high < 10)).toBe(true);
  });
  it('lowers condition with wear and structural damage', () => {
    expect(estimateCondition({ ...inspected, edges: 'minor' }).raw).toBe('LP');
    expect(estimateCondition({ ...inspected, surface: 'moderate' }).raw).toBe('MP');
    expect(estimateCondition({ ...inspected, corners: 'heavy' }).raw).toBe('HP');
    expect(estimateCondition({ ...inspected, creases: 'major' }).raw).toBe('DMG');
  });
  it('centering can restrict a screening range without changing raw condition', () => {
    const result = estimateCondition({ ...inspected, frontCentering: 84 }); expect(result.raw).toBe('NM'); expect(result.gradeRanges.every(r => r.high <= 5)).toBe(true);
  });
  it('unknown wear does not improve an estimate or make a price eligible', () => {
    const result = estimateCondition({ ...inspected, corners: 'unknown' }); expect(result.raw).toBe(null); expect(result.gradeRanges.every(r => r.low === 1)).toBe(true);
  });
  it('preserves graded designations in condition keys', () => {
    expect(conditionKey({ kind: 'graded', graded: { company: 'BGS', grade: 10, designation: 'Black Label' } })).not.toBe(conditionKey({ kind: 'graded', graded: { company: 'BGS', grade: 10, designation: 'Pristine' } }));
  });
});
describe('only current exact raw-condition samples can be used', () => {
  const now = Date.now();
  const sample: RawAskingSample = { cardId: 'base1-4', variant: 'holofoil', condition: 'LP', language: 'English', verifiedFilters: true, basis: 'asking', low: 12, median: 15, count: 2, asOf: new Date(now).toISOString(), sourceUrl: 'https://www.tcgplayer.com/product/123' };
  it('accepts an exact current match', () => { expect(usableRawSample(sample, 'base1-4', 'holofoil', 'LP', now)).toBe(sample); });
  it('rejects another card, printing, condition, stale date or currency-free invalid price', () => {
    expect(usableRawSample(sample, 'base1-58', 'holofoil', 'LP', now)).toBe(null);
    expect(usableRawSample(sample, 'base1-4', 'reverseHolofoil', 'LP', now)).toBe(null);
    expect(usableRawSample(sample, 'base1-4', 'holofoil', 'NM', now)).toBe(null);
    expect(usableRawSample({ ...sample, asOf: new Date(now - 86_400_001).toISOString() }, 'base1-4', 'holofoil', 'LP', now)).toBe(null);
    expect(usableRawSample({ ...sample, median: NaN }, 'base1-4', 'holofoil', 'LP', now)).toBe(null);
  });
});
