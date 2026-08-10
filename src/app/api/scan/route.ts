/**
 * POST /api/scan — the main scan endpoint.
 *
 * Takes a captured photo and returns identification, pricing, and an
 * authenticity report. Each stage degrades independently: a pricing failure
 * still returns the identification, and an identification failure still returns
 * the authenticity signals that do not need to know which card it is.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { bufferFromDataUrl, detectCard, detectionFromGuide, rectifyCard, encodeRaw } from '@/lib/image/rectify';
import { assessQuality } from '@/lib/image/quality';
import { identifyCard } from '@/lib/identify/pipeline';
import { getCardCached } from '@/lib/tcg-cache';
import { toCard } from '@/lib/tcg-api';
import { buildPricing } from '@/lib/pricing/engine';
import { buildReport } from '@/lib/auth/engine';
import { geometrySignal } from '@/lib/auth/signals/geometry';
import { printSignal } from '@/lib/auth/signals/print';
import { visionSignal } from '@/lib/auth/signals/vision';
import { abstain } from '@/lib/auth/engine';
import type { ScanResult } from '@/lib/types';

// Heavy image work needs the Node runtime, not edge.
export const runtime = 'nodejs';
export const maxDuration = 120;

const Body = z.object({
  image: z.string().min(64, 'image data is required'),
  guide: z
    .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
    .nullish(),
  /** Bulk scans skip the vision pass to stay fast and cheap. */
  fast: z.boolean().optional(),
  scanId: z.string().optional(),
});

export async function POST(request: Request) {
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof z.ZodError ? err.issues[0]?.message : 'Malformed request' },
      { status: 400 },
    );
  }

  let photo: Buffer;
  try {
    photo = bufferFromDataUrl(parsed.image);
  } catch {
    return NextResponse.json({ error: 'Image could not be decoded' }, { status: 400 });
  }

  try {
    // --- Locate and flatten the card -------------------------------------
    let detection = await detectCard(photo);
    if (detection.confidence < 0.35 && parsed.guide) {
      detection = detectionFromGuide(parsed.guide);
    }
    const rectified = await rectifyCard(photo, detection.corners);
    const quality = await assessQuality(rectified);

    const [tl, tr, br, bl] = detection.corners;
    const cardWidthPx =
      (Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(br.x - bl.x, br.y - bl.y)) / 2;

    // --- Identify ---------------------------------------------------------
    const identify = await identifyCard(rectified, { skipVision: parsed.fast });
    const chosen = identify.autoSelected ? identify.candidates[0] : undefined;

    // --- Price ------------------------------------------------------------
    let pricing: ScanResult['pricing'] = null;
    let card: ScanResult['card'] = chosen?.card ?? null;

    if (chosen) {
      const cached = await getCardCached(chosen.card.id);
      if (cached) {
        card = toCard(cached.data);
        pricing = buildPricing(cached.data);
        if (cached.degraded) {
          pricing.caveats.unshift(
            `Prices are from cached data (${Math.round(cached.ageSeconds / 3600)}h old) ` +
              'because the card database is currently unreachable.',
          );
        }
      }
    }

    // --- Authenticity -----------------------------------------------------
    // Vision is network-bound; start it before the CPU-bound signals so the two
    // overlap. Bulk scans skip it for speed and cost.
    const visionPromise = parsed.fast
      ? Promise.resolve(
          abstain(
            'vision',
            'Visual inspection',
            1.6,
            'not_applicable',
            'Visual inspection is skipped in bulk scanning. Scan this card on its own for a full check.',
          ),
        )
      : encodeRaw(rectified, 'jpeg', 92).then((buf) =>
          visionSignal({ image: buf, card, imageUsable: !quality.tooBlurry && !quality.tooDark }),
        );

    const signals = [
      geometrySignal({
        measuredAspect: detection.measuredAspect,
        detectionConfidence: detection.confidence,
        method: detection.method,
      }),
      quality.tooBlurry
        ? abstain(
            'print',
            'Print pattern',
            1.4,
            'insufficient_data',
            'The photo is too soft to analyse the print pattern. Retake it with the card flat and in focus.',
          )
        : printSignal(rectified, cardWidthPx),
      await visionPromise,
    ];

    const contextLimitations: string[] = [];
    if (card) {
      contextLimitations.push(
        `Compared against ${card.name} (${card.set.name} ${card.number}/${card.set.printedTotal}). ` +
          'If that is not the right card, these results do not apply.',
      );
    } else {
      contextLimitations.push(
        'The card could not be identified confidently, so checks that compare against the ' +
          'official artwork could not run.',
      );
    }
    contextLimitations.push(...quality.warnings);

    const auth = buildReport({ cardId: card?.id ?? null, signals, contextLimitations });

    const result: ScanResult & { quality: typeof quality; detection: { method: string; confidence: number } } = {
      scanId: parsed.scanId ?? crypto.randomUUID(),
      capturedAt: new Date().toISOString(),
      identify,
      card,
      pricing,
      auth,
      imageRef: `data:image/jpeg;base64,${(await encodeRaw(rectified, 'jpeg', 82)).toString('base64')}`,
      quality,
      detection: { method: detection.method, confidence: detection.confidence },
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error('[scan] failed', err);
    return NextResponse.json(
      { error: 'The scan could not be completed. Try again with a clearer photo.' },
      { status: 500 },
    );
  }
}
