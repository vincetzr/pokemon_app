/**
 * Claude vision access.
 *
 * Every feature here is optional. When ANTHROPIC_API_KEY is absent the app must
 * still work end to end — identification falls back to on-device OCR, and the
 * authenticity report omits the vision signal and lowers its own confidence to
 * match. Nothing silently degrades: the caller can always tell whether vision
 * ran.
 */

import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';

/** Vision work here is detail-sensitive, so use the most capable model. */
export const VISION_MODEL = 'claude-opus-5';

let client: Anthropic | null = null;

export function visionAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function getClient(): Anthropic | null {
  if (!visionAvailable()) return null;
  if (!client) client = new Anthropic();
  return client;
}

/**
 * Prepare an image for upload.
 *
 * Resolution is capped deliberately. Claude accepts up to 2576px on the long
 * edge, but that costs roughly 4784 image tokens; a card rendered at 1024–1568px
 * carries more than enough detail to read its name and collector number, at a
 * fraction of the cost. Authenticity work gets the larger size because it looks
 * at fine surface detail; identification gets the smaller one.
 */
export async function encodeImage(
  buffer: Buffer,
  maxEdge: number,
): Promise<{ media_type: 'image/jpeg'; data: string }> {
  const jpeg = await sharp(buffer)
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();

  return { media_type: 'image/jpeg', data: jpeg.toString('base64') };
}

export const IMAGE_SIZE = {
  /** Enough to read the name and collector number. */
  identify: 1024,
  /** Larger, for surface and print detail. */
  authenticity: 1568,
} as const;

export interface VisionCallOptions {
  /** Fail fast rather than blocking a scan indefinitely. */
  timeoutMs?: number;
}

/**
 * Run a vision request that returns JSON matching `schema`.
 *
 * Returns null rather than throwing on any failure — a vision outage must
 * degrade the scan, not break it.
 */
export async function visionJson<T>(
  args: {
    image: { media_type: 'image/jpeg'; data: string };
    system: string;
    prompt: string;
    schema: Record<string, unknown>;
    maxTokens?: number;
  },
  opts: VisionCallOptions = {},
): Promise<T | null> {
  const anthropic = getClient();
  if (!anthropic) return null;

  try {
    const response = await anthropic.messages.create(
      {
        model: VISION_MODEL,
        max_tokens: args.maxTokens ?? 2048,
        system: args.system,
        output_config: {
          format: { type: 'json_schema', schema: args.schema },
        },
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: args.image.media_type, data: args.image.data },
              },
              { type: 'text', text: args.prompt },
            ],
          },
        ],
      },
      { timeout: opts.timeoutMs ?? 90_000 },
    );

    // Safety classifiers can decline a request; content is empty or partial.
    if (response.stop_reason === 'refusal') {
      console.warn('[vision] request declined by safety classifiers');
      return null;
    }

    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return null;

    return JSON.parse(text.text) as T;
  } catch (err) {
    console.warn(`[vision] request failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}
