/**
 * Reading card identity from a photo with Claude vision.
 *
 * This complements OCR rather than replacing it. Measured against official card
 * images, OCR reads the name reliably but manages the collector number only
 * about two thirds of the time, and its position moves between eras. Vision
 * handles the cases OCR struggles with — small text over busy artwork, stylised
 * name fonts on full-art cards, and cards where the layout differs from what the
 * region map expects.
 */

import 'server-only';
import type { ExtractedText } from './lookup';
import { IMAGE_SIZE, encodeImage, visionJson, visionAvailable } from '../vision/client';

const SCHEMA = {
  type: 'object',
  properties: {
    name: {
      type: ['string', 'null'],
      description: 'The Pokemon or card name exactly as printed, or null if not legible.',
    },
    collectorNumber: {
      type: ['string', 'null'],
      description:
        'The collector number as printed, without the denominator. e.g. "4" from "4/102", ' +
        '"188" from "188/185", "SV107" from "SV107/SV122". Null if not legible.',
    },
    setTotal: {
      type: ['string', 'null'],
      description: 'The denominator of the collector line, e.g. "102" from "4/102". Null if absent.',
    },
    setName: {
      type: ['string', 'null'],
      description: 'Set name if identifiable from the set logo or symbol, else null.',
    },
    language: {
      type: ['string', 'null'],
      description: 'Printed language, e.g. "English", "Japanese". Null if unclear.',
    },
    confidence: {
      type: 'number',
      description: 'Confidence that the readings above are correct, 0 to 1.',
    },
    legibilityNotes: {
      type: 'string',
      description: 'Anything that limited the reading: glare, blur, crop, angle. Empty if none.',
    },
  },
  required: ['name', 'collectorNumber', 'setTotal', 'setName', 'language', 'confidence', 'legibilityNotes'],
  additionalProperties: false,
} as const;

interface VisionRead {
  name: string | null;
  collectorNumber: string | null;
  setTotal: string | null;
  setName: string | null;
  language: string | null;
  confidence: number;
  legibilityNotes: string;
}

const SYSTEM = `You read identifying information off Pokemon Trading Card Game cards.

Report only what is actually visible in the image. Do not infer a collector number
from your knowledge of which set a card belongs to, and do not correct what is
printed — if the card says "188/185", report exactly that, because secret rares
legitimately exceed their set's printed total.

If something is not legible, return null for it. A null is far more useful than a
guess: a wrong collector number sends the lookup to the wrong printing entirely,
whereas a null lets other evidence decide.`;

const PROMPT = `Read this Pokemon card and report:

- the card name as printed at the top (include suffixes like "V", "VMAX", "ex", "GX")
- the collector number and its denominator, usually in small text along the bottom edge
- the set name if the set logo or symbol identifies it
- the printed language

Report only what you can actually see. Use null for anything illegible, and note
in legibilityNotes whatever limited your reading.`;

export interface VisionIdentifyResult {
  extracted: ExtractedText;
  confidence: number;
  notes: string;
  language: string | null;
}

/** Read a card's identity. Returns null when vision is unavailable or failed. */
export async function readCardWithVision(image: Buffer): Promise<VisionIdentifyResult | null> {
  if (!visionAvailable()) return null;

  const encoded = await encodeImage(image, IMAGE_SIZE.identify);
  const result = await visionJson<VisionRead>({
    image: encoded,
    system: SYSTEM,
    prompt: PROMPT,
    schema: SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 1024,
  });

  if (!result) return null;

  return {
    extracted: {
      name: result.name,
      number: result.collectorNumber,
      setTotal: result.setTotal,
      setHint: result.setName,
      // Vision reads far more reliably than OCR, so its readings are trusted
      // more heavily when scoring candidates.
      nameConfidence: result.name ? Math.max(result.confidence, 0.7) : 0,
    },
    confidence: result.confidence,
    notes: result.legibilityNotes,
    language: result.language,
  };
}
