/**
 * Print signal: is there a halftone screen consistent with offset printing?
 *
 * Genuine cards are mass-produced on offset presses, which lay down colour as a
 * regular halftone screen — a periodic dot pattern at roughly 133–175 lines per
 * inch. This is one of the few signals that probes the manufacturing process
 * rather than the artwork.
 *
 * It is ONE-SIDED: it can support a card, never accuse one. The naive test is
 * wrong in both directions. A rosette does not prove authenticity, because
 * counterfeits are CMYK-printed too and offset-press fakes are documented. And
 * a missing rosette does not indicate a fake, because phone noise reduction and
 * JPEG chroma subsampling erase the screen from photos of genuine cards. So a
 * detected screen scores modestly, and a missing one abstains.
 *
 * Three measured facts constrain the implementation:
 *
 *  1. The official card images we compare against are clean digital renders and
 *     carry NO halftone signature (measured high/low frequency energy ratios of
 *     0.10–0.58 on flat regions). So this cannot be a comparison against the
 *     reference. It is an absolute test on the user's own photo.
 *
 *  2. Resolving a 133–175 LPI screen across a 63mm card needs roughly 1300–1750
 *     pixels across the card. Below that the screen is simply not present in the
 *     data, and any "measurement" would be noise. The signal ABSTAINS rather
 *     than scoring, which is the whole point.
 */

import type { AuthSignal } from '../../types';
import type { RawImage } from '../../image/rectify';
import { HALFTONE_LPI_RANGE, RESOLUTION_TIERS, lpiToCyclesPerPixel } from '../../card-geometry';
import { abstain } from '../engine';

const ID = 'print' as const;
const LABEL = 'Print pattern';
// Weighted low: a one-sided supporting signal should not dominate a verdict.
export const WEIGHT = 0.7;

/** Spectral concentration above which a periodic screen is genuinely present. */
const SCREEN_PRESENT_RATIO = 1.2;

/** Patch size for the FFT. A power of two keeps the transform cheap. */
const PATCH = 128;

export interface PrintResult {
  signal: AuthSignal;
}

/**
 * Analyse a rectified card image for periodic screen structure.
 *
 * `cardWidthPx` is how many pixels the card's 63mm width occupied in the
 * ORIGINAL photo, not in the rectified output — upscaling during rectification
 * cannot create detail that the camera never captured.
 */
export function printSignal(rectified: RawImage, cardWidthPx: number): AuthSignal {
  if (cardWidthPx < RESOLUTION_TIERS.print) {
    return abstain(
      ID,
      LABEL,
      WEIGHT,
      'insufficient_data',
      `Print pattern analysis needs about ${RESOLUTION_TIERS.print} pixels across the card; ` +
        `this photo has roughly ${Math.round(cardWidthPx)}. Move closer or use a higher ` +
        `resolution camera to enable this check.`,
    );
  }

  const patches = samplePatches(rectified);
  if (patches.length === 0) {
    return abstain(ID, LABEL, WEIGHT, 'insufficient_data', 'No suitable flat area was found to analyse.');
  }

  // Where the halftone screen should appear, in cycles per pixel.
  const bandLow = lpiToCyclesPerPixel(HALFTONE_LPI_RANGE.min, cardWidthPx);
  const bandHigh = lpiToCyclesPerPixel(HALFTONE_LPI_RANGE.max, cardWidthPx);

  const ratios = patches.map((p) => screenEnergyRatio(p, bandLow, bandHigh));
  ratios.sort((a, b) => a - b);
  const median = ratios[Math.floor(ratios.length / 2)]!;

  // ONE-SIDED BY DESIGN — this signal may support, never accuse.
  //
  // Both directions of the naive test are wrong. A rosette does not prove a card
  // is genuine: counterfeits are CMYK-printed too, and 2025 CGC alerts confirm
  // offset-press fakes ("even most fakes have a rosette pattern"). And absence
  // does not prove a fake: phone multi-frame noise reduction, JPEG chroma
  // subsampling and mild defocus each erase a 133–175 LPI screen from a
  // genuine card.
  //
  // So a detected screen contributes a modest positive, and a missing one makes
  // the signal ABSTAIN rather than score low. Scoring absence would accuse
  // every genuine card photographed on a phone that denoises aggressively —
  // which is all of them.
  if (median < SCREEN_PRESENT_RATIO) {
    return abstain(
      ID,
      LABEL,
      WEIGHT,
      'insufficient_data',
      'No regular print screen was resolvable in this photo. That is expected from phone noise ' +
        'reduction and JPEG compression on a genuine card, so nothing is concluded from it.',
    );
  }

  // Above the presence threshold the score is capped well below 100: the
  // strongest honest statement is "consistent with offset printing", which is
  // supporting evidence, not proof.
  const score = Math.round(
    70 + Math.min(1, (median - SCREEN_PRESENT_RATIO) / 0.8) * 25,
  );

  return {
    id: ID,
    label: LABEL,
    status: 'ok',
    score,
    weight: WEIGHT,
    summary:
      'A regular print screen is present, consistent with the offset printing used for genuine ' +
      'cards. Note that competent counterfeits are also offset-printed, so this supports the card ' +
      'without proving it.',
    measurements: {
      screenEnergyRatio: Number(median.toFixed(3)),
      patchesAnalysed: patches.length,
      cardWidthPx: Math.round(cardWidthPx),
      searchBandLpi: `${HALFTONE_LPI_RANGE.min}-${HALFTONE_LPI_RANGE.max}`,
      oneSided: true,
    },
  };
}

/**
 * Take patches from flat-ish areas. Busy artwork has its own high-frequency
 * content that would swamp the screen frequency, so patches whose variance is
 * too high are rejected.
 */
function samplePatches(img: RawImage): Float32Array[] {
  const { data, width, height } = img;
  const out: Float32Array[] = [];

  // Sample across the card, skipping the outer edge where rectification is least
  // reliable and the very centre where artwork is busiest.
  const positions: [number, number][] = [
    [0.10, 0.20], [0.85, 0.20], [0.10, 0.60], [0.85, 0.60],
    [0.30, 0.93], [0.65, 0.93], [0.50, 0.06], [0.20, 0.45],
  ];

  for (const [fx, fy] of positions) {
    const x0 = Math.round(fx * width - PATCH / 2);
    const y0 = Math.round(fy * height - PATCH / 2);
    if (x0 < 0 || y0 < 0 || x0 + PATCH >= width || y0 + PATCH >= height) continue;

    const patch = new Float32Array(PATCH * PATCH);
    let sum = 0;
    for (let y = 0; y < PATCH; y++) {
      for (let x = 0; x < PATCH; x++) {
        const i = ((y0 + y) * width + (x0 + x)) * 3;
        // Luminance carries the screen structure across all inks.
        const lum = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
        patch[y * PATCH + x] = lum;
        sum += lum;
      }
    }

    const mean = sum / patch.length;
    let variance = 0;
    for (const v of patch) variance += (v - mean) ** 2;
    variance /= patch.length;

    // Reject near-black or blown-out patches, and very busy ones.
    const sd = Math.sqrt(variance);
    if (mean < 25 || mean > 240 || sd > 70) continue;

    for (let i = 0; i < patch.length; i++) patch[i]! -= mean;
    out.push(patch);
  }

  return out;
}

/**
 * Ratio of spectral energy inside the expected halftone band to the energy just
 * outside it. Above 1 means there is a genuine periodic concentration there
 * rather than a smooth noise floor.
 */
function screenEnergyRatio(patch: Float32Array, bandLow: number, bandHigh: number): number {
  const mag = fft2Magnitude(patch, PATCH);

  let inBand = 0;
  let inCount = 0;
  let outBand = 0;
  let outCount = 0;

  const half = PATCH / 2;
  for (let v = 0; v < PATCH; v++) {
    for (let u = 0; u < PATCH; u++) {
      // Frequency in cycles per pixel, centred.
      const fu = (u <= half ? u : u - PATCH) / PATCH;
      const fv = (v <= half ? v : v - PATCH) / PATCH;
      const f = Math.hypot(fu, fv);
      if (f === 0) continue;

      const power = mag[v * PATCH + u]!;
      if (f >= bandLow && f <= bandHigh) {
        inBand += power;
        inCount++;
      } else if (f >= bandLow * 0.4 && f < bandLow) {
        outBand += power;
        outCount++;
      }
    }
  }

  if (inCount === 0 || outCount === 0 || outBand === 0) return 0;
  return inBand / inCount / (outBand / outCount);
}

/** 2D FFT magnitude via separable 1D transforms. */
function fft2Magnitude(input: Float32Array, n: number): Float32Array {
  const re = Float64Array.from(input);
  const im = new Float64Array(n * n);

  const rowRe = new Float64Array(n);
  const rowIm = new Float64Array(n);

  // Rows.
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      rowRe[x] = re[y * n + x]!;
      rowIm[x] = im[y * n + x]!;
    }
    fft1(rowRe, rowIm, n);
    for (let x = 0; x < n; x++) {
      re[y * n + x] = rowRe[x]!;
      im[y * n + x] = rowIm[x]!;
    }
  }

  // Columns.
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      rowRe[y] = re[y * n + x]!;
      rowIm[y] = im[y * n + x]!;
    }
    fft1(rowRe, rowIm, n);
    for (let y = 0; y < n; y++) {
      re[y * n + x] = rowRe[y]!;
      im[y * n + x] = rowIm[y]!;
    }
  }

  const out = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) out[i] = Math.hypot(re[i]!, im[i]!);
  return out;
}

/** In-place iterative radix-2 Cooley-Tukey FFT. `n` must be a power of two. */
function fft1(re: Float64Array, im: Float64Array, n: number): void {
  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k]!;
        const uIm = im[i + k]!;
        const vRe = re[i + k + len / 2]! * curRe - im[i + k + len / 2]! * curIm;
        const vIm = re[i + k + len / 2]! * curIm + im[i + k + len / 2]! * curRe;

        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;

        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}
