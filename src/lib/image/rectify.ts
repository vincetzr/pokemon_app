/**
 * Finding a card in a photo and flattening it to a canonical rectangle.
 *
 * Everything downstream — colour comparison, layout alignment, print analysis —
 * assumes a straight-on view of the card at a known size. A phone photo is
 * never that, so we locate the card's quadrilateral, solve the homography that
 * maps it to a rectangle, and resample.
 *
 * Implemented directly on raw pixel buffers rather than pulling in OpenCV: the
 * transform is only an 8-parameter solve plus a bilinear resample, and a WASM
 * OpenCV build would dominate the bundle for no accuracy gain at this scale.
 */

import sharp from 'sharp';
import { CARD_ASPECT } from '../card-geometry';

export interface Point {
  x: number;
  y: number;
}

export interface RawImage {
  data: Buffer;
  width: number;
  height: number;
  /** Bytes per pixel; always 3 (RGB) after `loadRaw`. */
  channels: 3;
}

/** The canonical rectified size. Short edge sits above the print-analysis tier. */
export const RECTIFIED_WIDTH = 1500;
export const RECTIFIED_HEIGHT = Math.round(RECTIFIED_WIDTH / CARD_ASPECT);

export async function loadRaw(input: Buffer, maxWidth?: number): Promise<RawImage> {
  let pipeline = sharp(input, { failOn: 'none' }).rotate(); // honour EXIF orientation
  if (maxWidth) {
    pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true });
  }
  const { data, info } = await pipeline.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: 3 };
}

/** Decode a `data:` URL into a Buffer. */
export function bufferFromDataUrl(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) throw new Error('Malformed data URL');
  return Buffer.from(dataUrl.slice(comma + 1), 'base64');
}

// ---------------------------------------------------------------------------
// Card detection
// ---------------------------------------------------------------------------

export interface DetectionResult {
  /** Corners in source-image coordinates, ordered TL, TR, BR, BL. */
  corners: [Point, Point, Point, Point];
  /** 0–1 confidence that this really is a card boundary. */
  confidence: number;
  method: 'contour' | 'guide' | 'full-frame';
  /** Measured aspect ratio of the detected quad, for the geometry signal. */
  measuredAspect: number;
}

/**
 * Locate the card by finding the dominant foreground region.
 *
 * The approach is deliberately simple and predictable: work at low resolution,
 * separate foreground from background with Otsu's method on a combined
 * luminance/saturation channel, keep the largest connected component, then take
 * its extreme points along the two diagonals as the quadrilateral corners.
 *
 * It handles the common case — one card against a contrasting surface — and
 * reports low confidence rather than a wrong answer when the scene is busy. The
 * caller falls back to the on-screen alignment guide in that case.
 */
export async function detectCard(input: Buffer): Promise<DetectionResult> {
  const WORK = 480;
  const img = await loadRaw(input, WORK);
  const { data, width: w, height: h } = img;

  // Score each pixel on how "card-like" it is versus the background. Cards are
  // usually more saturated and brighter than a table surface; combining both
  // beats either alone under warm indoor light.
  const score = new Float32Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 3) {
    const r = data[p]!, g = data[p + 1]!, b = data[p + 2]!;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const sat = max === 0 ? 0 : (max - min) / max;
    score[i] = lum * 0.6 + sat * 255 * 0.4;
  }

  const threshold = otsu(score);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < score.length; i++) mask[i] = score[i]! > threshold ? 1 : 0;

  const component = largestComponent(mask, w, h);
  if (!component || component.size < w * h * 0.06) {
    return fullFrame(img.width, img.height, 'full-frame', 0.15);
  }

  // Corners of a convex quad are the extrema along x+y and x-y.
  let tl = component.points[0]!, br = tl, tr = tl, bl = tl;
  let minSum = Infinity, maxSum = -Infinity, minDiff = Infinity, maxDiff = -Infinity;
  for (const pt of component.points) {
    const sum = pt.x + pt.y;
    const diff = pt.x - pt.y;
    if (sum < minSum) { minSum = sum; tl = pt; }
    if (sum > maxSum) { maxSum = sum; br = pt; }
    if (diff > maxDiff) { maxDiff = diff; tr = pt; }
    if (diff < minDiff) { minDiff = diff; bl = pt; }
  }

  // Scale back up to full-resolution source coordinates.
  const meta = await sharp(input).rotate().metadata();
  const fullW = meta.width ?? img.width;
  const fullH = meta.height ?? img.height;
  const sx = fullW / w;
  const sy = fullH / h;
  const corners: [Point, Point, Point, Point] = [
    { x: tl.x * sx, y: tl.y * sy },
    { x: tr.x * sx, y: tr.y * sy },
    { x: br.x * sx, y: br.y * sy },
    { x: bl.x * sx, y: bl.y * sy },
  ];

  const measuredAspect = quadAspect(corners);
  const fill = component.size / (w * h);
  const aspectError = Math.abs(measuredAspect - CARD_ASPECT) / CARD_ASPECT;

  // Confidence blends how much of the frame the card fills with how close the
  // detected shape is to a real card's proportions.
  const confidence = clamp01(
    0.5 * clamp01((fill - 0.06) / 0.5) + 0.5 * clamp01(1 - aspectError / 0.25),
  );

  return { corners, confidence, method: 'contour', measuredAspect };
}

function fullFrame(width: number, height: number, method: DetectionResult['method'], confidence: number): DetectionResult {
  const corners: [Point, Point, Point, Point] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  return { corners, confidence, method, measuredAspect: width / height };
}

/** Build a detection from an explicit guide rectangle the UI drew. */
export function detectionFromGuide(guide: { x: number; y: number; width: number; height: number }): DetectionResult {
  return {
    corners: [
      { x: guide.x, y: guide.y },
      { x: guide.x + guide.width, y: guide.y },
      { x: guide.x + guide.width, y: guide.y + guide.height },
      { x: guide.x, y: guide.y + guide.height },
    ],
    // The guide says where we ASKED the user to put the card, not where it is.
    // Confidence stays moderate so geometry never scores highly on it alone.
    confidence: 0.5,
    method: 'guide',
    measuredAspect: guide.width / guide.height,
  };
}

/** Average of the two opposite-edge aspect ratios of a quadrilateral. */
function quadAspect(c: [Point, Point, Point, Point]): number {
  const [tl, tr, br, bl] = c;
  const top = dist(tl, tr);
  const bottom = dist(bl, br);
  const left = dist(tl, bl);
  const right = dist(tr, br);
  const width = (top + bottom) / 2;
  const height = (left + right) / 2;
  return height === 0 ? 0 : width / height;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Otsu's method: pick the threshold that minimises intra-class variance. */
function otsu(values: Float32Array): number {
  const BINS = 256;
  const hist = new Float64Array(BINS);
  let max = 0;
  for (const v of values) if (v > max) max = v;
  if (max === 0) return 0;

  for (const v of values) {
    const bin = Math.min(BINS - 1, Math.floor((v / max) * (BINS - 1)));
    hist[bin]! += 1;
  }

  const total = values.length;
  let sum = 0;
  for (let i = 0; i < BINS; i++) sum += i * hist[i]!;

  let sumB = 0, wB = 0, best = 0, bestVar = -1;
  for (let i = 0; i < BINS; i++) {
    wB += hist[i]!;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * hist[i]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > bestVar) { bestVar = between; best = i; }
  }
  return (best / (BINS - 1)) * max;
}

/** Largest 4-connected component of the mask, via an iterative flood fill. */
function largestComponent(
  mask: Uint8Array,
  w: number,
  h: number,
): { size: number; points: Point[] } | null {
  const seen = new Uint8Array(w * h);
  let best: { size: number; points: Point[] } | null = null;
  const stack: number[] = [];

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== 1 || seen[start] === 1) continue;

    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    const points: Point[] = [];

    while (stack.length > 0) {
      const idx = stack.pop()!;
      const x = idx % w;
      const y = (idx - x) / w;
      points.push({ x, y });

      if (x > 0 && mask[idx - 1] === 1 && seen[idx - 1] === 0) { seen[idx - 1] = 1; stack.push(idx - 1); }
      if (x < w - 1 && mask[idx + 1] === 1 && seen[idx + 1] === 0) { seen[idx + 1] = 1; stack.push(idx + 1); }
      if (y > 0 && mask[idx - w] === 1 && seen[idx - w] === 0) { seen[idx - w] = 1; stack.push(idx - w); }
      if (y < h - 1 && mask[idx + w] === 1 && seen[idx + w] === 0) { seen[idx + w] = 1; stack.push(idx + w); }
    }

    if (!best || points.length > best.size) best = { size: points.length, points };
  }

  return best;
}

// ---------------------------------------------------------------------------
// Homography
// ---------------------------------------------------------------------------

/**
 * Solve the 3x3 homography mapping four source points to four destination
 * points, as an 8-unknown linear system (h33 fixed at 1).
 */
export function solveHomography(src: Point[], dst: Point[]): number[] {
  if (src.length !== 4 || dst.length !== 4) {
    throw new Error('Homography needs exactly four point correspondences');
  }

  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]!;
    const { x: X, y: Y } = dst[i]!;
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
    b.push(Y);
  }

  const h = solveLinear(A, b);
  return [...h, 1];
}

/** Gaussian elimination with partial pivoting. */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[pivot]![col]!)) pivot = r;
    }
    if (Math.abs(M[pivot]![col]!) < 1e-12) throw new Error('Degenerate point configuration');
    [M[col], M[pivot]] = [M[pivot]!, M[col]!];

    const pivotVal = M[col]![col]!;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r]![col]! / pivotVal;
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) M[r]![c]! -= factor * M[col]![c]!;
    }
  }

  return Array.from({ length: n }, (_, i) => M[i]![n]! / M[i]![i]!);
}

/**
 * Resample the quadrilateral into a straight rectangle using the inverse
 * homography and bilinear interpolation.
 */
export async function rectifyCard(
  input: Buffer,
  corners: [Point, Point, Point, Point],
  outWidth = RECTIFIED_WIDTH,
  outHeight = RECTIFIED_HEIGHT,
): Promise<RawImage> {
  const src = await loadRaw(input);

  // Map destination -> source, so every output pixel samples a real input pixel.
  const dstCorners: Point[] = [
    { x: 0, y: 0 },
    { x: outWidth - 1, y: 0 },
    { x: outWidth - 1, y: outHeight - 1 },
    { x: 0, y: outHeight - 1 },
  ];
  const H = solveHomography(dstCorners, corners);

  const out = Buffer.alloc(outWidth * outHeight * 3);
  const { data, width: sw, height: sh } = src;

  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      const denom = H[6]! * x + H[7]! * y + H[8]!;
      const sx = (H[0]! * x + H[1]! * y + H[2]!) / denom;
      const sy = (H[3]! * x + H[4]! * y + H[5]!) / denom;
      const o = (y * outWidth + x) * 3;

      if (sx < 0 || sy < 0 || sx >= sw - 1 || sy >= sh - 1) {
        out[o] = 0; out[o + 1] = 0; out[o + 2] = 0;
        continue;
      }

      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * sw + x0) * 3;
      const i10 = i00 + 3;
      const i01 = i00 + sw * 3;
      const i11 = i01 + 3;

      for (let c = 0; c < 3; c++) {
        const top = data[i00 + c]! * (1 - fx) + data[i10 + c]! * fx;
        const bottom = data[i01 + c]! * (1 - fx) + data[i11 + c]! * fx;
        out[o + c] = Math.round(top * (1 - fy) + bottom * fy);
      }
    }
  }

  return { data: out, width: outWidth, height: outHeight, channels: 3 };
}

/** Encode a raw image back to a PNG/JPEG buffer. */
export async function encodeRaw(
  img: RawImage,
  format: 'png' | 'jpeg' = 'jpeg',
  quality = 90,
): Promise<Buffer> {
  const pipeline = sharp(img.data, {
    raw: { width: img.width, height: img.height, channels: 3 },
  });
  return format === 'png' ? pipeline.png().toBuffer() : pipeline.jpeg({ quality }).toBuffer();
}
