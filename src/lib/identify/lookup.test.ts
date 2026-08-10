import { describe, expect, it } from 'vitest';
import {
  editDistance,
  nameSimilarity,
  normaliseName,
  parseCollectorLine,
  scoreCandidate,
  shouldAutoSelect,
} from './lookup';
import type { Card } from '../types';

function card(partial: Partial<Card> & Pick<Card, 'id' | 'name' | 'number'>): Card {
  return {
    supertype: 'Pokémon',
    subtypes: [],
    rarity: 'Rare Holo',
    artist: null,
    images: { small: '', large: '' },
    variants: ['holofoil'],
    set: {
      id: 'base1',
      name: 'Base',
      series: 'Base',
      printedTotal: 102,
      total: 102,
      releaseDate: '1999/01/09',
      images: { symbol: '', logo: '' },
    },
    ...partial,
  } as Card;
}

describe('parseCollectorLine', () => {
  it.each([
    ['4/102', '4', '102'],
    ['025/165', '25', '165'],
    ['199/165', '199', '165'],
    ['SV107/SV122', 'SV107', 'SV122'],
    ['TG12/TG30', 'TG12', 'TG30'],
    ['4 / 102', '4', '102'],
  ])('parses %s', (input, number, setTotal) => {
    expect(parseCollectorLine(input)).toEqual({ number, setTotal });
  });

  it('parses a promo number with no denominator', () => {
    expect(parseCollectorLine('SWSH284')).toEqual({ number: 'SWSH284', setTotal: null });
  });

  it('parses a bare number', () => {
    expect(parseCollectorLine('58')).toEqual({ number: '58', setTotal: null });
  });

  it('returns nulls for unparseable junk', () => {
    expect(parseCollectorLine('!!!')).toEqual({ number: null, setTotal: null });
  });
});

describe('name matching', () => {
  it('normalises the punctuation OCR gets wrong', () => {
    expect(normaliseName("Farfetch'd")).toBe('farfetchd');
    expect(normaliseName('Mr. Mime')).toBe('mrmime');
    expect(normaliseName('Ho-Oh')).toBe('hooh');
    expect(normaliseName('Flabébé')).toBe('flabebe');
  });

  it('scores an exact match at 1', () => {
    expect(nameSimilarity('Charizard', 'Charizard')).toBe(1);
  });

  it('tolerates single-character OCR errors', () => {
    expect(nameSimilarity('Charlzard', 'Charizard')).toBeGreaterThan(0.85);
    expect(nameSimilarity('Blastoisc', 'Blastoise')).toBeGreaterThan(0.85);
  });

  it('treats a truncated read as a strong prefix match', () => {
    expect(nameSimilarity('Chariz', 'Charizard')).toBeGreaterThan(0.85);
  });

  it('keeps genuinely different names apart', () => {
    expect(nameSimilarity('Charizard', 'Blastoise')).toBeLessThan(0.4);
    expect(nameSimilarity('Pikachu', 'Raichu')).toBeLessThan(0.75);
  });

  it('computes edit distance correctly', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('abc', 'abc')).toBe(0);
  });
});

describe('scoreCandidate', () => {
  const charizard = card({ id: 'base1-4', name: 'Charizard', number: '4' });

  it('scores a full match near 1', () => {
    const { score, evidence } = scoreCandidate(charizard, {
      name: 'Charizard',
      number: '4',
      setTotal: '102',
      setHint: null,
    });
    expect(score).toBeGreaterThan(0.95);
    expect(evidence.join(' ')).toContain('collector number 4');
  });

  it('separates two printings of the same card by set total', () => {
    const base = card({ id: 'base1-4', name: 'Charizard', number: '4' });
    const reprint = card({
      id: 'bs2-4',
      name: 'Charizard',
      number: '4',
      set: { ...base.set, id: 'base2', name: 'Base Set 2', printedTotal: 130, total: 130, releaseDate: '2000/02/24' },
    });

    const extracted = { name: 'Charizard', number: '4', setTotal: '102', setHint: null };
    expect(scoreCandidate(base, extracted).score).toBeGreaterThan(
      scoreCandidate(reprint, extracted).score,
    );
  });

  it('does not penalise a card for evidence that could not be read', () => {
    // Only the name was legible. A correct card should still score high.
    const { score } = scoreCandidate(charizard, {
      name: 'Charizard',
      number: null,
      setTotal: null,
      setHint: null,
    });
    expect(score).toBeGreaterThan(0.95);
  });

  it('scores a wrong card low even when the number happens to match', () => {
    const other = card({ id: 'xy1-4', name: 'Weedle', number: '4' });
    const { score } = scoreCandidate(other, {
      name: 'Charizard',
      number: '4',
      setTotal: '102',
      setHint: null,
    });
    expect(score).toBeLessThan(0.5);
  });
});

describe('shouldAutoSelect', () => {
  const c = (id: string, confidence: number) => ({
    card: card({ id, name: 'X', number: '1' }),
    confidence,
    evidence: [],
  });

  it('auto-selects a confident, clearly-ahead match', () => {
    expect(shouldAutoSelect([c('a', 0.95), c('b', 0.5)])).toBe(true);
  });

  it('refuses when two candidates are nearly tied', () => {
    // Two near-identical printings: asking the user beats guessing.
    expect(shouldAutoSelect([c('a', 0.95), c('b', 0.9)])).toBe(false);
  });

  it('refuses when the best match is weak', () => {
    expect(shouldAutoSelect([c('a', 0.6)])).toBe(false);
  });

  it('handles an empty candidate list', () => {
    expect(shouldAutoSelect([])).toBe(false);
  });
});

describe('name confidence gating', () => {
  const pikachuVmax = card({
    id: 'swsh4-188',
    name: 'Pikachu VMAX',
    number: '188',
    set: {
      id: 'swsh4', name: 'Vivid Voltage', series: 'Sword & Shield',
      printedTotal: 185, total: 203, releaseDate: '2020/11/13',
      images: { symbol: '', logo: '' },
    },
  });

  it('does not let a garbled low-confidence name veto a perfect number match', () => {
    // Real OCR output for this card: the collector number read perfectly but
    // the name came back as noise at 22% confidence.
    const { score } = scoreCandidate(pikachuVmax, {
      name: 'MAX aRIKachu. Yay',
      number: '188',
      setTotal: '185',
      setHint: null,
      nameConfidence: 0.22,
    });
    expect(score).toBeGreaterThan(0.6);
  });

  it('still penalises a confidently-read name that disagrees', () => {
    const { score } = scoreCandidate(pikachuVmax, {
      name: 'Blastoise',
      number: '188',
      setTotal: '185',
      setHint: null,
      nameConfidence: 0.95,
    });
    expect(score).toBeLessThan(0.5);
  });

  it('treats a missing confidence as fully trusted', () => {
    const without = scoreCandidate(pikachuVmax, {
      name: 'Blastoise', number: '188', setTotal: '185', setHint: null,
    }).score;
    const explicit = scoreCandidate(pikachuVmax, {
      name: 'Blastoise', number: '188', setTotal: '185', setHint: null, nameConfidence: 1,
    }).score;
    expect(without).toBeCloseTo(explicit, 6);
  });
});
