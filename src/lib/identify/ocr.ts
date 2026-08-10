/**
 * On-device OCR of a rectified card.
 *
 * Measured behaviour on official card images rectified to 1500px wide, which is
 * what shaped this design:
 *
 *   Name line       reads reliably. "Charizard", "Pikachu", "Cinderace V" all
 *                   came back correct even with frame artwork bleeding into the
 *                   crop, at 38-93% reported confidence.
 *
 *   Collector line  marginal. It is the smallest text on the card — roughly 30
 *                   pixels tall at this scale — and sits over busy artwork.
 *                   "188/185" read perfectly on a modern card; Base Set's
 *                   "4/102" came back as "4710". Its vertical position also
 *                   moves between eras.
 *
 * So the collector line is not read from one fixed region. Several horizontal
 * strips across the plausible band are recognised, and the first that yields a
 * well-formed collector pattern wins. A wrong guess is worse than no guess, so
 * anything that fails the pattern is discarded rather than passed on as noise.
 */

import sharp from 'sharp';
import { createWorker, type Worker } from 'tesseract.js';
import type { RawImage } from '../image/rectify';
import { REGIONS, regionToPixels, clampRect } from '../card-geometry';
import { parseCollectorLine } from './lookup';

export interface OcrResult {
  name: string | null;
  nameConfidence: number;
  number: string | null;
  setTotal: string | null;
  collectorConfidence: number;
  /** Everything recognised, for debugging and manual correction in the UI. */
  rawText: string[];
}

/**
 * Vertical positions to search for the collector line, as fractions of card
 * height. The line sits lower on modern cards than on WOTC-era ones, so the
 * band is swept rather than assumed.
 */
const COLLECTOR_BAND = [0.925, 0.938, 0.950, 0.962, 0.974];
const STRIP_HEIGHT = 0.024;

let workerPromise: Promise<Worker> | null = null;

/** Tesseract worker startup is expensive, so one instance is reused. */
async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('eng').catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

export async function terminateOcr(): Promise<void> {
  if (!workerPromise) return;
  const worker = await workerPromise.catch(() => null);
  workerPromise = null;
  await worker?.terminate();
}

async function toPng(img: RawImage): Promise<Buffer> {
  return sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } })
    .png()
    .toBuffer();
}

/**
 * Crop, then upscale and boost contrast. Tesseract is markedly better on large,
 * high-contrast input, and these crops are small.
 */
async function prepareCrop(
  card: Buffer,
  rect: { x: number; y: number; width: number; height: number },
  scale = 3,
): Promise<Buffer> {
  return sharp(card)
    .extract({ left: rect.x, top: rect.y, width: rect.width, height: rect.height })
    .greyscale()
    .normalise()
    .resize({ width: rect.width * scale })
    .sharpen()
    .png()
    .toBuffer();
}

export async function readCard(rectified: RawImage): Promise<OcrResult> {
  const card = await toPng(rectified);
  const bounds = { width: rectified.width, height: rectified.height };
  const rawText: string[] = [];

  let worker: Worker;
  try {
    worker = await getWorker();
  } catch {
    // OCR unavailable (missing WASM assets, offline). Identification falls back
    // to Claude vision or manual search; it must not crash the scan.
    return {
      name: null,
      nameConfidence: 0,
      number: null,
      setTotal: null,
      collectorConfidence: 0,
      rawText: [],
    };
  }

  // --- Name -----------------------------------------------------------------
  let name: string | null = null;
  let nameConfidence = 0;
  try {
    const rect = clampRect(regionToPixels(REGIONS.nameBar, bounds), bounds);
    const { data } = await worker.recognize(await prepareCrop(card, rect));
    rawText.push(data.text.trim());
    name = extractName(data.text);
    nameConfidence = name ? data.confidence / 100 : 0;
  } catch {
    // Fall through with no name.
  }

  // --- Collector line -------------------------------------------------------
  let number: string | null = null;
  let setTotal: string | null = null;
  let collectorConfidence = 0;

  for (const y of COLLECTOR_BAND) {
    if (number) break;
    try {
      const rect = clampRect(
        {
          x: 0,
          y: Math.round(y * bounds.height),
          width: bounds.width,
          height: Math.round(STRIP_HEIGHT * bounds.height),
        },
        bounds,
      );
      const { data } = await worker.recognize(await prepareCrop(card, rect, 4));
      rawText.push(data.text.trim());

      const found = extractCollector(data.text);
      if (found) {
        number = found.number;
        setTotal = found.setTotal;
        collectorConfidence = data.confidence / 100;
      }
    } catch {
      // Try the next strip.
    }
  }

  return { name, nameConfidence, number, setTotal, collectorConfidence, rawText };
}

/**
 * Pull a card name out of a noisy OCR line.
 *
 * The name crop also catches the stage line ("STAGE 2", "BASIC"), HP, and frame
 * artwork rendered as punctuation soup. The name is the longest run of
 * plausible name characters that is not one of those known labels.
 */
export function extractName(text: string): string | null {
  const NOISE = /^(basic|stage\s*[12]|evolves|hp|restored|item|supporter|stadium|energy|v|vmax|vstar|ex|gx)$/i;

  const candidates = text
    .split(/[\n|]/)
    .flatMap((line) => line.split(/\s{2,}/))
    .map((chunk) =>
      chunk
        // Keep letters, digits, and the punctuation real names use.
        .replace(/[^A-Za-zÀ-ÿ0-9'’.\- ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((chunk) => chunk.length >= 3)
    .filter((chunk) => !NOISE.test(chunk))
    // Must contain a real run of letters, not just stray capitals.
    .filter((chunk) => /[A-Za-zÀ-ÿ]{3,}/.test(chunk));

  if (candidates.length === 0) return null;

  // Prefer the chunk with the highest ratio of letters to junk, breaking ties
  // by length — real names are mostly letters.
  candidates.sort((a, b) => {
    const score = (s: string) => (s.replace(/[^A-Za-zÀ-ÿ]/g, '').length / s.length) * 10 + s.length / 20;
    return score(b) - score(a);
  });

  const best = candidates[0]!;
  // Trim a trailing suffix the name crop often clips, e.g. "Charizard §".
  return best.replace(/\s+[^A-Za-zÀ-ÿ0-9]+$/, '').trim() || null;
}

/**
 * Find a collector number in a noisy line.
 *
 * Requires a well-formed "N/M" pattern. The line is surrounded by copyright
 * text and illustrator credits that OCR mangles badly, so a strict pattern is
 * what separates a real reading from noise. A number without a denominator is
 * NOT accepted here: too many stray digits in that region would match.
 */
export function extractCollector(text: string): { number: string; setTotal: string } | null {
  const flat = text.replace(/\s+/g, ' ');

  // Collector numbers are 1-4 chars, optionally prefixed (SV, TG, GG), over a
  // similar denominator. Require both sides to avoid matching copyright years.
  const matches = flat.matchAll(/\b([A-Z]{0,3}\d{1,4})\s*\/\s*([A-Z]{0,3}\d{1,4})\b/gi);

  for (const m of matches) {
    const parsed = parseCollectorLine(`${m[1]}/${m[2]}`);
    if (!parsed.number || !parsed.setTotal) continue;

    // A four-digit denominator is a year, not a set size.
    const total = Number(parsed.setTotal.replace(/\D/g, ''));
    if (Number.isFinite(total) && (total < 1 || total > 999)) continue;

    return { number: parsed.number, setTotal: parsed.setTotal };
  }

  return null;
}
