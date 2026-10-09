import 'server-only';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { decodePixels } from './decode';
import { parseSlab, type BarcodeRead } from './rules';

export async function readSlabImage(photo: Buffer, provided: BarcodeRead[] = [], readLabel = false) {
  const reads = new Map(provided.map(r => [r.text, r]));
  const normalized = await sharp(photo).rotate().resize({ width: 2000, height: 2400, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  for (const angle of [0, 90]) {
    const { data, info } = await sharp(normalized).rotate(angle).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const read = decodePixels(data, info.width, info.height);
    if (read) reads.set(read.text, read);
  }
  let label = '';
  if (readLabel) {
    const metadata = await sharp(normalized).metadata();
    const height = metadata.height! / metadata.width! > 1.1 ? Math.round(metadata.height! * .42) : metadata.height!;
    const crop = await sharp(normalized).extract({ left: 0, top: 0, width: metadata.width!, height }).greyscale().normalise().png().toBuffer();
    let worker: Awaited<ReturnType<typeof createWorker>> | null = null, timedOut = false;
    let timeout: ReturnType<typeof setTimeout>;
    const recognition = (async () => {
      worker = await createWorker('eng');
      if (timedOut) { await worker.terminate(); return ''; }
      return (await worker.recognize(crop)).data.text;
    })();
    try {
      label = await Promise.race([recognition, new Promise<string>((_resolve, reject) => { timeout = setTimeout(() => { timedOut = true; void worker?.terminate(); reject(new Error('Label OCR timeout')); }, 20_000); })]);
    } catch { /* Barcode and manual-entry flow survive unavailable OCR. */ }
    finally { clearTimeout(timeout!); void (worker as Awaited<ReturnType<typeof createWorker>> | null)?.terminate().catch(() => undefined); }
  }
  return parseSlab(label, [...reads.values()]);
}
