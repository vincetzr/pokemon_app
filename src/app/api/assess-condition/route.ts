import { NextResponse } from 'next/server';
import { z } from 'zod';
import { bufferFromDataUrl, detectCard, rectifyCard, encodeRaw } from '@/lib/image/rectify';
import { assessQuality } from '@/lib/image/quality';
import { inspectBackPixels } from '@/lib/grading/photo';
import { EMPTY_OBSERVATIONS } from '@/lib/grading/rules';
import { inspectConditionWithVision } from '@/lib/grading/vision';

export const runtime = 'nodejs';
export const maxDuration = 60;
const Body = z.object({ front: z.string().max(24_000_000), back: z.string().max(24_000_000), throughHolder: z.boolean().optional() });
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Front and back photos are required.' }, { status: 400 });
  if (parsed.data.throughHolder) return NextResponse.json({ observations: { ...EMPTY_OBSERVATIONS, throughHolder: true }, notes: 'Use the printed slab grade. Do not estimate wear through plastic.' });
  try {
    const prepare = async (url: string) => {
      const image = bufferFromDataUrl(url), detection = await detectCard(image);
      const rectified = await rectifyCard(image, detection.corners), quality = await assessQuality(rectified);
      const [tl, tr, br, bl] = detection.corners;
      const width = (Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(br.x - bl.x, br.y - bl.y)) / 2;
      const usable = width >= 600 && !quality.tooBlurry && !quality.tooDark && !quality.hasGlare && Math.abs(detection.measuredAspect - 63 / 88) < .045;
      return { rectified, usable, image: await encodeRaw(rectified, 'jpeg', 92) };
    };
    const [front, back] = await Promise.all([prepare(parsed.data.front), prepare(parsed.data.back)]);
    const observations = { ...EMPTY_OBSERVATIONS, frontUsable: front.usable, backUsable: back.usable };
    const vision = await inspectConditionWithVision(front.image, back.image, front.usable && back.usable);
    if (vision) return NextResponse.json({ ...vision, method: 'photo inspection', needsReview: true });
    const wear = back.usable ? inspectBackPixels(back.rectified.data, back.rectified.width, back.rectified.height, 3) : null;
    if (wear?.usable) { observations.edges = wear.edges; observations.corners = wear.corners; }
    return NextResponse.json({ observations, notes: wear?.note ?? 'Retake clear front and back photos of the bare card on a contrasting background. Surface and creases need manual review.', method: 'back-border whitening', needsReview: true });
  } catch { return NextResponse.json({ error: 'The photos could not be assessed. Retake them in focus with the whole card visible.' }, { status: 400 }); }
}
