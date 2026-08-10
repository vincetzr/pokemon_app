/**
 * Geometry signal: does the card have the proportions of a real card?
 *
 * Honest scope: this catches gross size errors — a card cut to the wrong
 * dimensions, or a photo of a card on a screen with the wrong aspect. It does
 * NOT catch a well-made counterfeit, which is cut to spec.
 *
 * It is included because it is cheap and because the failure it does catch
 * (trimmed cards) is a real and common fraud in the graded market. It carries a
 * low weight accordingly.
 *
 * Calibration comes from measurement, not assumption. Official scans of modern
 * cards sit 0.12% from the true 63x88mm aspect while vintage Base Set scans sit
 * 1.6% off — the cards are fine, the scans are cropped differently. A user's
 * photo adds perspective error on top of that. So anything under ~3% is noise.
 */

import type { AuthSignal } from '../../types';
import { CARD_ASPECT, ASPECT_TOLERANCE } from '../../card-geometry';
import { abstain, scoreFromDeviation } from '../engine';

const ID = 'geometry' as const;
const LABEL = 'Shape and proportions';
const WEIGHT = 0.8;

export interface GeometryInput {
  /** Aspect ratio measured from the detected card quadrilateral. */
  measuredAspect: number;
  /** How confident the detector was that it found a real card boundary. */
  detectionConfidence: number;
  /** How the boundary was obtained. A guide box is where we ASKED the user to
   *  put the card, not where it was measured to be, so it proves nothing. */
  method: 'contour' | 'guide' | 'full-frame';
}

export function geometrySignal(input: GeometryInput): AuthSignal {
  if (input.method !== 'contour') {
    return abstain(
      ID,
      LABEL,
      WEIGHT,
      'insufficient_data',
      input.method === 'guide'
        ? 'The card outline came from the on-screen guide rather than being measured, so ' +
            'its proportions cannot be checked.'
        : 'No card outline could be found in this photo, so its proportions cannot be checked.',
    );
  }

  if (input.detectionConfidence < 0.45) {
    return abstain(
      ID,
      LABEL,
      WEIGHT,
      'insufficient_data',
      'The card edges could not be located confidently enough to measure its proportions.',
    );
  }

  const deviation = Math.abs(input.measuredAspect - CARD_ASPECT) / CARD_ASPECT;
  const score = scoreFromDeviation(deviation, ASPECT_TOLERANCE.nominal, ASPECT_TOLERANCE.suspicious * 2);

  const pct = (deviation * 100).toFixed(1);
  const summary =
    deviation <= ASPECT_TOLERANCE.nominal
      ? `Proportions match a standard card (within ${pct}% of 63x88mm).`
      : deviation <= ASPECT_TOLERANCE.suspicious
        ? `Proportions are ${pct}% off standard. Perspective in the photo can account for this.`
        : `Proportions are ${pct}% off a standard 63x88mm card. This can indicate a trimmed ` +
          `or wrongly-cut card, but a steep camera angle produces the same reading.`;

  return {
    id: ID,
    label: LABEL,
    status: 'ok',
    score,
    weight: WEIGHT,
    summary,
    measurements: {
      measuredAspect: Number(input.measuredAspect.toFixed(4)),
      officialAspect: Number(CARD_ASPECT.toFixed(4)),
      deviationPercent: Number(pct),
      detectionConfidence: Number(input.detectionConfidence.toFixed(2)),
    },
  };
}
