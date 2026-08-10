import { describe, expect, it } from 'vitest';
import { abstain, buildReport, scoreFromDeviation, UNIVERSAL_LIMITATIONS } from './engine';
import type { AuthSignal } from '../types';

function signal(id: AuthSignal['id'], score: number | null, weight = 1, status: AuthSignal['status'] = 'ok'): AuthSignal {
  return {
    id,
    label: id,
    status,
    score,
    weight,
    summary: `${id} summary`,
    measurements: {},
  };
}

describe('buildReport', () => {
  it('reaches a genuine-consistent verdict when signals broadly pass', () => {
    const report = buildReport({
      cardId: 'base1-4',
      signals: [signal('geometry', 90), signal('color', 85), signal('print', 80), signal('text', 75)],
    });

    expect(report.verdict).toBe('consistent_with_genuine');
    expect(report.score).toBeGreaterThanOrEqual(70);
    expect(report.concerns).toHaveLength(0);
  });

  it('raises red flags when signals broadly fail', () => {
    const report = buildReport({
      cardId: 'base1-4',
      signals: [signal('geometry', 20), signal('color', 15), signal('print', 30), signal('text', 25)],
    });

    expect(report.verdict).toBe('red_flags');
    expect(report.concerns.length).toBeGreaterThan(0);
  });

  it('never claims certainty, even when every signal passes perfectly', () => {
    const report = buildReport({
      cardId: 'base1-4',
      signals: [
        signal('geometry', 100),
        signal('color', 100),
        signal('print', 100),
        signal('text', 100),
        signal('holo', 100),
        signal('vision', 100),
      ],
    });

    // A photo-only analysis must not present itself as conclusive.
    expect(report.confidence).toBeLessThanOrEqual(0.85);
    expect(report.limitations.length).toBeGreaterThanOrEqual(UNIVERSAL_LIMITATIONS.length);
  });

  describe('abstention', () => {
    it('excludes abstaining signals from the score rather than scoring them zero', () => {
      const withAbstention = buildReport({
        cardId: 'x',
        signals: [
          signal('geometry', 90),
          signal('color', 90),
          abstain('print', 'print', 1, 'insufficient_data', 'too low resolution'),
          abstain('holo', 'holo', 1, 'not_applicable', 'not a holo card'),
        ],
      });

      // Were abstentions scored as 0, the mean would be 45 and the verdict would
      // flip to inconclusive or worse. They must simply not count.
      expect(withAbstention.score).toBe(90);
      expect(withAbstention.verdict).toBe('consistent_with_genuine');
    });

    it('lowers confidence as more signals abstain', () => {
      const full = buildReport({
        cardId: 'x',
        signals: [signal('geometry', 90), signal('color', 90), signal('print', 90), signal('text', 90)],
      });
      const partial = buildReport({
        cardId: 'x',
        signals: [
          signal('geometry', 90),
          signal('color', 90),
          abstain('print', 'print', 1, 'insufficient_data', 'blurry'),
          abstain('text', 'text', 1, 'insufficient_data', 'blurry'),
        ],
      });

      expect(partial.confidence).toBeLessThan(full.confidence);
    });

    it('refuses a verdict when too little could run', () => {
      const report = buildReport({
        cardId: 'x',
        signals: [
          signal('geometry', 95),
          abstain('color', 'color', 1, 'insufficient_data', 'glare'),
          abstain('print', 'print', 1, 'insufficient_data', 'blurry'),
          abstain('text', 'text', 1, 'insufficient_data', 'blurry'),
        ],
      });

      // One passing signal is not grounds to declare a card genuine.
      expect(report.verdict).toBe('inconclusive');
    });

    it('will not declare red flags off a single failing signal', () => {
      const report = buildReport({
        cardId: 'x',
        signals: [
          signal('color', 10),
          abstain('geometry', 'geometry', 1, 'insufficient_data', 'no card found'),
          abstain('print', 'print', 1, 'insufficient_data', 'blurry'),
          abstain('text', 'text', 1, 'insufficient_data', 'blurry'),
        ],
      });

      expect(report.verdict).toBe('inconclusive');
    });

    it('records which checks abstained in the limitations', () => {
      const report = buildReport({
        cardId: 'x',
        signals: [
          signal('geometry', 90),
          signal('color', 90),
          abstain('print', 'print resolution', 1, 'insufficient_data', 'too soft'),
        ],
      });

      expect(report.limitations.join(' ')).toContain('print resolution');
    });
  });

  it('respects signal weights', () => {
    const report = buildReport({
      cardId: 'x',
      signals: [signal('geometry', 100, 3), signal('color', 0, 1)],
    });
    // Weighted mean: (100*3 + 0*1) / 4 = 75
    expect(report.score).toBe(75);
  });

  it('handles a report where every signal abstained', () => {
    const report = buildReport({
      cardId: 'x',
      signals: [
        abstain('geometry', 'geometry', 1, 'error', 'failed'),
        abstain('color', 'color', 1, 'error', 'failed'),
      ],
    });

    expect(report.verdict).toBe('inconclusive');
    expect(report.score).toBe(0);
    expect(report.confidence).toBe(0);
  });
});

describe('scoreFromDeviation', () => {
  it('scores at or below the good threshold as 100', () => {
    expect(scoreFromDeviation(0, 0.03, 0.12)).toBe(100);
    expect(scoreFromDeviation(0.03, 0.03, 0.12)).toBe(100);
  });

  it('scores at or beyond the bad threshold as 0', () => {
    expect(scoreFromDeviation(0.12, 0.03, 0.12)).toBe(0);
    expect(scoreFromDeviation(0.5, 0.03, 0.12)).toBe(0);
  });

  it('interpolates linearly between the thresholds', () => {
    expect(scoreFromDeviation(0.075, 0.03, 0.12)).toBe(50);
  });
});

describe('accusation confidence ceiling', () => {
  it('caps confidence lower for a red-flags verdict than for a passing one', () => {
    const full = (score: number) =>
      buildReport({
        cardId: 'x',
        signals: [
          signal('geometry', score),
          signal('color', score),
          signal('print', score),
          signal('text', score),
          signal('holo', score),
          signal('vision', score),
        ],
      });

    const passing = full(95);
    const accusing = full(10);

    expect(passing.verdict).toBe('consistent_with_genuine');
    expect(accusing.verdict).toBe('red_flags');

    // The two error directions are not symmetric: a wrong accusation costs the
    // user far more than a missed fake, so it must clear a higher bar.
    expect(accusing.confidence).toBeLessThanOrEqual(0.65);
    expect(accusing.confidence).toBeLessThan(passing.confidence);
  });
});
