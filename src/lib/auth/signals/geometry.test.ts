import { describe, expect, it } from 'vitest';
import { geometrySignal } from './geometry';
import { CARD_ASPECT } from '../../card-geometry';

describe('geometrySignal', () => {
  const base = { detectionConfidence: 0.8, method: 'contour' as const };

  it('scores a correctly proportioned card highly', () => {
    const s = geometrySignal({ ...base, measuredAspect: CARD_ASPECT });
    expect(s.status).toBe('ok');
    expect(s.score).toBe(100);
  });

  it('still scores a plausibly trimmed card rather than abstaining', () => {
    // 10% narrow: a real trim lands here, and this is the case the signal exists
    // to catch, so it must produce a low score rather than opting out.
    const s = geometrySignal({ ...base, measuredAspect: CARD_ASPECT * 0.9 });
    expect(s.status).toBe('ok');
    expect(s.score).toBeLessThan(45);
  });

  it('abstains rather than accusing when the outline is not card-shaped', () => {
    // A photo containing no card produced a near-square region at 0.5
    // confidence, which cleared the confidence gate and then scored 0/100.
    // "We could not find the card" must not be reported as "this card is wrong".
    const s = geometrySignal({ ...base, measuredAspect: 1.0 });
    expect(s.status).toBe('insufficient_data');
    expect(s.score).toBeNull();
  });

  it('abstains on a guide box, which proves nothing about the card', () => {
    const s = geometrySignal({ ...base, method: 'guide', measuredAspect: CARD_ASPECT });
    expect(s.status).toBe('insufficient_data');
  });
});
