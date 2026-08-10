/**
 * The identification pipeline: photo in, ranked card candidates out.
 *
 * OCR and vision run against the rectified card and their readings are merged
 * field by field rather than one being chosen wholesale. In practice each is
 * better at a different part of the card — OCR reads the large name text
 * reliably and cheaply, vision handles the small collector line and stylised
 * full-art fonts — so taking the better reading per field beats picking a
 * winner per photo.
 */

import 'server-only';
import type { IdentifyResult } from '../types';
import type { RawImage } from '../image/rectify';
import { encodeRaw } from '../image/rectify';
import { type ExtractedText, shouldAutoSelect } from './lookup';
import { readCard } from './ocr';
import { readCardWithVision } from './vision';
import { findCandidates } from './resolve';
import { visionAvailable } from '../vision/client';

export interface IdentifyOptions {
  /** Skip the vision pass even when a key is configured (bulk scans, cost control). */
  skipVision?: boolean;
}

export async function identifyCard(
  rectified: RawImage,
  opts: IdentifyOptions = {},
): Promise<IdentifyResult> {
  const warnings: string[] = [];
  const useVision = visionAvailable() && !opts.skipVision;

  // Run both readers concurrently — vision is network-bound, OCR is CPU-bound.
  const [ocr, vision] = await Promise.all([
    readCard(rectified).catch(() => null),
    useVision
      ? encodeRaw(rectified, 'jpeg')
          .then(readCardWithVision)
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  if (!useVision) {
    warnings.push(
      visionAvailable()
        ? 'Vision reading was skipped for speed; identification used on-device text recognition only.'
        : 'No Anthropic API key is configured, so identification used on-device text recognition only.',
    );
  } else if (!vision) {
    warnings.push('Vision reading was unavailable; falling back to on-device text recognition.');
  }

  if (vision?.notes) {
    warnings.push(`Vision noted: ${vision.notes}`);
  }

  const extracted = mergeReadings(ocr, vision);

  if (!extracted.name && !extracted.number) {
    warnings.push(
      'Neither the card name nor its collector number could be read. Retake the photo ' +
        'straight-on with the whole card in frame, or search for the card by name.',
    );
    return {
      candidates: [],
      extracted: publicExtract(extracted),
      autoSelected: false,
      method: methodOf(ocr, vision),
      warnings,
    };
  }

  const outcome = await findCandidates(extracted);
  warnings.push(...outcome.warnings);

  const autoSelected = shouldAutoSelect(outcome.candidates);
  if (!autoSelected && outcome.candidates.length > 1) {
    warnings.push(
      'Several printings match closely. Pick the right one — prices differ substantially ' +
        'between printings of the same card.',
    );
  }

  return {
    candidates: outcome.candidates,
    extracted: publicExtract(extracted),
    autoSelected,
    method: methodOf(ocr, vision),
    warnings,
  };
}

type OcrResult = Awaited<ReturnType<typeof readCard>>;
type VisionResult = Awaited<ReturnType<typeof readCardWithVision>>;

/**
 * Merge the two readings field by field, preferring whichever reader is more
 * trustworthy for that field.
 */
export function mergeReadings(ocr: OcrResult | null, vision: VisionResult | null): ExtractedText {
  // Name: take the higher-confidence reading. OCR is competitive here, and when
  // the two agree, confidence is raised because independent agreement is real
  // evidence rather than one reader being echoed back.
  let name: string | null = null;
  let nameConfidence = 0;

  const ocrName = ocr?.name ?? null;
  const visionName = vision?.extracted.name ?? null;
  const visionNameConfidence = vision?.extracted.nameConfidence ?? 0;

  if (ocrName && visionName) {
    const agree = normalise(ocrName) === normalise(visionName);
    if (agree) {
      name = visionName;
      nameConfidence = Math.min(0.98, Math.max(ocr!.nameConfidence, visionNameConfidence) + 0.15);
    } else {
      // Disagreement: trust vision, which reads stylised text far better, but
      // do not claim high confidence when the two readers disagree.
      name = visionName;
      nameConfidence = Math.min(visionNameConfidence, 0.7);
    }
  } else if (visionName) {
    name = visionName;
    nameConfidence = visionNameConfidence;
  } else if (ocrName) {
    name = ocrName;
    nameConfidence = ocr!.nameConfidence;
  }

  // Collector number: prefer vision. OCR only manages this line on roughly two
  // thirds of cards, and a wrong number picks the wrong printing outright.
  const number = vision?.extracted.number ?? ocr?.number ?? null;
  const setTotal = vision?.extracted.setTotal ?? ocr?.setTotal ?? null;

  return {
    name,
    number,
    setTotal,
    setHint: vision?.extracted.setHint ?? null,
    nameConfidence,
  };
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function publicExtract(e: ExtractedText): IdentifyResult['extracted'] {
  return { name: e.name, number: e.number, setTotal: e.setTotal, setHint: e.setHint };
}

function methodOf(ocr: OcrResult | null, vision: VisionResult | null): IdentifyResult['method'] {
  const hasOcr = Boolean(ocr?.name || ocr?.number);
  const hasVision = Boolean(vision);
  if (hasOcr && hasVision) return 'ocr+vision';
  if (hasVision) return 'vision';
  return 'ocr';
}
