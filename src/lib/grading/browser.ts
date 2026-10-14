import { createWorker } from 'tesseract.js';
import { decodePixels } from './decode';
import { inspectBackPixels } from './photo';
import { parseSlab, type BarcodeRead, type SlabRead } from './rules';
import type { GradingCompany } from '../types';
export * from './rules';
export * from './photo';
export * from './condition-price';

export async function imageCanvas(source: string | Blob): Promise<HTMLCanvasElement> {
  const objectUrl = typeof source !== 'string' ? URL.createObjectURL(source) : null;
  try {
    const image = new Image(); image.src = objectUrl ?? source as string;
    await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Image capture is unavailable.');
    ctx.drawImage(image, 0, 0); return canvas;
  } finally { if (objectUrl) URL.revokeObjectURL(objectUrl); }
}
export async function scanBarcodes(canvas: HTMLCanvasElement): Promise<BarcodeRead[]> {
  const reads = new Map<string, BarcodeRead>();
  const Detector = (globalThis as unknown as { BarcodeDetector?: { new(): { detect(image: HTMLCanvasElement): Promise<{ rawValue: string; format: string }[]> } } }).BarcodeDetector;
  if (Detector) {
    try { for (const r of await new Detector().detect(canvas)) if (r.rawValue.length <= 500) reads.set(r.rawValue, { text: r.rawValue, format: r.format }); } catch { /* portable decoder below */ }
  }
  // Rotated 1D barcodes need their bars to cross the decoder's scanlines.
  for (const fraction of [1, .45]) for (const angle of [0, Math.PI / 2]) {
    const h = Math.round(canvas.height * fraction), scale = Math.min(1, 2000 / Math.max(canvas.width, h));
    const w = Math.round(canvas.width * scale), sh = Math.round(h * scale);
    const crop = document.createElement('canvas'); crop.width = angle ? sh : w; crop.height = angle ? w : sh;
    const ctx = crop.getContext('2d', { willReadFrequently: true })!;
    if (angle) { ctx.translate(sh, 0); ctx.rotate(angle); }
    ctx.drawImage(canvas, 0, 0, canvas.width, h, 0, 0, w, sh);
    const pixels = ctx.getImageData(0, 0, crop.width, crop.height);
    const r = decodePixels(pixels.data, pixels.width, pixels.height);
    if (r && r.text.length <= 500) reads.set(r.text, r);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return [...reads.values()];
}
export async function readSlabPhoto(source: string | Blob | HTMLCanvasElement, hint?: GradingCompany | null, onProgress?: (message: string) => void): Promise<SlabRead> {
  const canvas = source instanceof HTMLCanvasElement ? source : await imageCanvas(source);
  onProgress?.('Reading QR and 1D barcodes…');
  const barcodes = await scanBarcodes(canvas);
  onProgress?.(barcodes.length ? 'Barcode decoded. Reading the printed label…' : 'Reading the label. You can enter the certificate if the barcode is unclear…');
  const crop = document.createElement('canvas');
  const cropH = canvas.height / canvas.width > 1.1 ? Math.round(canvas.height * .42) : canvas.height;
  const scale = Math.min(2, 2000 / canvas.width); crop.width = Math.round(canvas.width * scale); crop.height = Math.round(cropH * scale);
  crop.getContext('2d')!.drawImage(canvas, 0, 0, canvas.width, cropH, 0, 0, crop.width, crop.height);
  let text = '', worker: Awaited<ReturnType<typeof createWorker>> | null = null, timedOut = false;
  let timer: ReturnType<typeof setTimeout>;
  const recognition = (async () => {
    worker = await createWorker('eng', 1, { workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js' });
    if (timedOut) { await worker.terminate(); return ''; }
    return (await worker.recognize(crop.toDataURL('image/png'))).data.text;
  })();
  try {
    text = await Promise.race([recognition, new Promise<string>((_resolve, reject) => { timer = setTimeout(() => { timedOut = true; void worker?.terminate(); reject(new Error('Label OCR timeout')); }, 35_000); })]);
  } catch { onProgress?.('Label reading is unavailable. Review the barcode or enter the label below.'); }
  finally { clearTimeout(timer!); void (worker as Awaited<ReturnType<typeof createWorker>> | null)?.terminate().catch(() => undefined); }
  return parseSlab(text, barcodes, hint);
}
export async function inspectBackPhoto(source: string | Blob) {
  const canvas = await imageCanvas(source);
  const pixels = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height);
  return inspectBackPixels(pixels.data, pixels.width, pixels.height);
}
