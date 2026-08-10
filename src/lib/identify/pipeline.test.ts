import { describe, expect, it } from 'vitest';
import { mergeReadings } from './pipeline';

type Ocr = Parameters<typeof mergeReadings>[0];
type Vis = Parameters<typeof mergeReadings>[1];

function ocr(partial: Partial<NonNullable<Ocr>>): Ocr {
  return {
    name: null,
    nameConfidence: 0,
    number: null,
    setTotal: null,
    collectorConfidence: 0,
    rawText: [],
    ...partial,
  } as NonNullable<Ocr>;
}

function vision(partial: {
  name?: string | null;
  number?: string | null;
  setTotal?: string | null;
  setHint?: string | null;
  nameConfidence?: number;
}): Vis {
  return {
    extracted: {
      name: partial.name ?? null,
      number: partial.number ?? null,
      setTotal: partial.setTotal ?? null,
      setHint: partial.setHint ?? null,
      nameConfidence: partial.nameConfidence ?? 0.8,
    },
    confidence: partial.nameConfidence ?? 0.8,
    notes: '',
    language: 'English',
  } as NonNullable<Vis>;
}

describe('mergeReadings', () => {
  it('raises confidence when both readers agree on the name', () => {
    const merged = mergeReadings(
      ocr({ name: 'Charizard', nameConfidence: 0.6 }),
      vision({ name: 'Charizard', nameConfidence: 0.8 }),
    );

    expect(merged.name).toBe('Charizard');
    // Independent agreement is real evidence, so confidence exceeds either alone.
    expect(merged.nameConfidence).toBeGreaterThan(0.8);
  });

  it('ignores punctuation differences when checking agreement', () => {
    const merged = mergeReadings(
      ocr({ name: 'Farfetchd', nameConfidence: 0.7 }),
      vision({ name: "Farfetch'd", nameConfidence: 0.8 }),
    );
    expect(merged.nameConfidence).toBeGreaterThan(0.8);
  });

  it('prefers vision but caps confidence when the readers disagree', () => {
    const merged = mergeReadings(
      ocr({ name: 'Blastoise', nameConfidence: 0.9 }),
      vision({ name: 'Charizard', nameConfidence: 0.9 }),
    );

    expect(merged.name).toBe('Charizard');
    // Disagreement must not produce a confident answer.
    expect(merged.nameConfidence).toBeLessThanOrEqual(0.7);
  });

  it('prefers the vision collector number over OCR', () => {
    // OCR misread the number; vision got it right.
    const merged = mergeReadings(
      ocr({ number: '4', setTotal: '102' }),
      vision({ number: '188', setTotal: '185' }),
    );

    expect(merged.number).toBe('188');
    expect(merged.setTotal).toBe('185');
  });

  it('falls back to the OCR number when vision could not read one', () => {
    const merged = mergeReadings(
      ocr({ number: '58', setTotal: '102' }),
      vision({ name: 'Pikachu', number: null, setTotal: null }),
    );

    expect(merged.number).toBe('58');
    expect(merged.setTotal).toBe('102');
  });

  it('works with OCR only', () => {
    const merged = mergeReadings(ocr({ name: 'Pikachu', nameConfidence: 0.93, number: '58' }), null);
    expect(merged.name).toBe('Pikachu');
    expect(merged.nameConfidence).toBeCloseTo(0.93, 5);
    expect(merged.number).toBe('58');
  });

  it('works with vision only', () => {
    const merged = mergeReadings(null, vision({ name: 'Cinderace V', number: '18', nameConfidence: 0.9 }));
    expect(merged.name).toBe('Cinderace V');
    expect(merged.number).toBe('18');
  });

  it('returns empty readings when both readers failed', () => {
    const merged = mergeReadings(null, null);
    expect(merged.name).toBeNull();
    expect(merged.number).toBeNull();
    expect(merged.nameConfidence).toBe(0);
  });

  it('carries a low OCR confidence through rather than inflating it', () => {
    // The real Pikachu VMAX case: garbled name, perfect number.
    const merged = mergeReadings(
      ocr({ name: 'MAX aRIKachu. Yay', nameConfidence: 0.22, number: '188', setTotal: '185' }),
      null,
    );
    expect(merged.nameConfidence).toBeCloseTo(0.22, 5);
    expect(merged.number).toBe('188');
  });
});
