/**
 * Orchestrates an authenticity analysis: photo in, report out.
 *
 * Order matters. Capture quality is assessed FIRST, because a soft or blown-out
 * photo makes several signals meaningless, and it is better to tell the user to
 * retake the photo than to run checks on data that cannot support them.
 */

import 'server-only';
import type { AuthReport, Card } from '../types';
import {
  type DetectionResult,
  type RawImage,
  detectCard,
  detectionFromGuide,
  rectifyCard,
} from '../image/rectify';
import { buildReport } from './engine';
import { geometrySignal } from './signals/geometry';
import { printSignal } from './signals/print';
import { assessQuality, type QualityReport } from '../image/quality';

export interface AnalyzeOptions {
  /** The card we believe this is, when identification already resolved it. */
  card?: Card | null;
  /** Guide rectangle from the camera overlay, used if edge detection fails. */
  guide?: { x: number; y: number; width: number; height: number } | null;
}

export interface AnalysisResult {
  report: AuthReport;
  quality: QualityReport;
  detection: DetectionResult;
  /** The rectified card, for display and for any later re-analysis. */
  rectified: RawImage;
}

export async function analyzeCard(
  photo: Buffer,
  opts: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  // 1. Find the card.
  let detection = await detectCard(photo);

  // Edge detection beats the guide box when it works, because it measures where
  // the card actually is. Fall back only when it clearly failed.
  if (detection.confidence < 0.35 && opts.guide) {
    detection = detectionFromGuide(opts.guide);
  }

  // 2. Flatten it.
  const rectified = await rectifyCard(photo, detection.corners);

  // 3. How many pixels the card occupied in the ORIGINAL photo. Rectification
  //    can upscale, but it cannot add detail the camera never captured, so this
  //    is the honest figure for gating resolution-dependent signals.
  const cardWidthPx = originalCardWidth(detection);

  // 4. Assess capture quality before running anything that depends on it.
  const quality = await assessQuality(rectified);

  // 5. Run the signals.
  const signals = [
    geometrySignal({
      measuredAspect: detection.measuredAspect,
      detectionConfidence: detection.confidence,
      method: detection.method,
    }),
    quality.tooBlurry
      ? blurAbstention()
      : printSignal(rectified, cardWidthPx),
  ];

  const contextLimitations: string[] = [];
  if (opts.card) {
    contextLimitations.push(
      `Compared against ${opts.card.name} (${opts.card.set.name} ${opts.card.number}/` +
        `${opts.card.set.printedTotal}). If that is not the right card, these results do not apply.`,
    );
  } else {
    contextLimitations.push(
      'The card could not be identified, so checks that compare against the official ' +
        'artwork could not run.',
    );
  }

  if (quality.warnings.length > 0) {
    contextLimitations.push(...quality.warnings);
  }

  return {
    report: buildReport({
      cardId: opts.card?.id ?? null,
      signals,
      contextLimitations,
    }),
    quality,
    detection,
    rectified,
  };
}

/** Width of the detected card quadrilateral, in original-photo pixels. */
function originalCardWidth(detection: DetectionResult): number {
  const [tl, tr, br, bl] = detection.corners;
  const top = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const bottom = Math.hypot(br.x - bl.x, br.y - bl.y);
  return (top + bottom) / 2;
}

function blurAbstention() {
  return {
    id: 'print' as const,
    label: 'Print pattern',
    status: 'insufficient_data' as const,
    score: null,
    weight: 1.4,
    summary: 'The photo is too soft to analyse the print pattern.',
    measurements: {},
    reason:
      'Fine print structure is destroyed by blur, so this check would measure the ' +
      'photo rather than the card. Retake it with the card flat and in focus.',
  };
}
