import 'server-only';
import { encodeImage, visionAvailable, visionJson } from '../vision/client';
import { EMPTY_OBSERVATIONS, type ConditionObservations } from './rules';
import { z } from 'zod';

const Wear = z.enum(['unknown', 'none', 'minor', 'moderate', 'heavy', 'severe']);
const Response = z.object({ corners: Wear, edges: Wear, surface: Wear, creases: z.enum(['unknown', 'none', 'minor', 'major']), notes: z.string() });
const schema = { type: 'object', properties: {
  corners: { type: 'string', enum: Wear.options }, edges: { type: 'string', enum: Wear.options }, surface: { type: 'string', enum: Wear.options }, creases: { type: 'string', enum: ['unknown', 'none', 'minor', 'major'] }, notes: { type: 'string' },
}, required: ['corners', 'edges', 'surface', 'creases', 'notes'], additionalProperties: false };
export async function inspectConditionWithVision(front: Buffer, back: Buffer, usable: boolean): Promise<{ observations: ConditionObservations; notes: string } | null> {
  if (!usable || !visionAvailable()) return null;
  const [image, reverse] = await Promise.all([encodeImage(front, 1568), encodeImage(back, 1568)]);
  const result = await visionJson({ image, additionalImages: [reverse], schema,
    system: 'You report visible wear on front and back photographs of a raw Pokémon trading card. The first image is the front; the second is the back. Do not assign an official grade or monetary price. Report unknown when blur, glare, plastic, cropping or angle hides an attribute. Do not mistake printed white artwork for whitening or a reflection for a scratch. Only report none when both sides show the attribute clearly. Never infer hidden dents, alterations or authenticity.',
    prompt: 'Inspect corners, edges, surface and creases on both sides. Distinguish visible wear from uncertain areas. Return conservative observations for user review, and explain limitations in notes.', maxTokens: 1024,
  }, { timeoutMs: 25_000 });
  const parsed = Response.safeParse(result);
  return parsed.success ? { observations: { ...EMPTY_OBSERVATIONS, ...parsed.data, frontUsable: true, backUsable: true }, notes: parsed.data.notes } : null;
}
