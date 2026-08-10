/**
 * Capture quality assessment.
 *
 * This exists to protect the authenticity engine from itself. Most signals
 * measure fine detail, and fine detail is exactly what a bad photo destroys.
 * Without a quality gate the engine would happily report that a genuine card
 * has no print screen when the real finding is that the photo was blurry.
 *
 * The output drives abstention decisions and the retake advice shown to users.
 */

import type { RawImage } from './rectify';

export interface QualityReport {
  /** Variance of the Laplacian — the standard sharpness proxy. Higher is sharper. */
  sharpness: number;
  /** Fraction of pixels blown out to near-white, which is what glare looks like. */
  glareFraction: number;
  /** Fraction crushed to near-black. */
  shadowFraction: number;
  /** Mean luminance, 0–255. */
  brightness: number;
  tooBlurry: boolean;
  tooDark: boolean;
  hasGlare: boolean;
  /** Plain-English problems worth telling the user about. */
  warnings: string[];
}

/**
 * Thresholds calibrated against rectified 1500px-wide card images. Laplacian
 * variance is scale-dependent, so these are only meaningful at that size — which
 * is why rectification always produces a fixed width.
 *
 * The sharpness threshold was measured, not chosen. Across official images:
 *
 *   card                 sharp   blur σ=2   blur σ=6
 *   Base Set Charizard      45          1          1
 *   Cinderace V            210          8          2
 *   SV 151 Charizard ex    131         11          2
 *
 * Two things follow. First, genuinely blurred images collapse to under ~12,
 * an order of magnitude below any acceptable capture, so the classes separate
 * cleanly. Second, sharpness varies enormously with era: the 1999 Base Set scan
 * measures 45 against 210 for a modern card, because vintage art is softer and
 * its scans are lower resolution. An earlier threshold of 120 flagged the
 * genuine Base Set reference image itself as too blurry — exactly the kind of
 * false accusation this whole module exists to prevent. 30 sits comfortably
 * between the two clusters.
 */
const THRESHOLDS = {
  sharpness: 30,
  glareFraction: 0.06,
  shadowFraction: 0.25,
  darkBrightness: 55,
} as const;

export async function assessQuality(img: RawImage): Promise<QualityReport> {
  const { data, width, height } = img;

  // Luminance plane.
  const lum = new Float32Array(width * height);
  let sum = 0;
  let glare = 0;
  let shadow = 0;

  for (let i = 0, p = 0; i < lum.length; i++, p += 3) {
    const v = 0.299 * data[p]! + 0.587 * data[p + 1]! + 0.114 * data[p + 2]!;
    lum[i] = v;
    sum += v;
    if (v > 246) glare++;
    if (v < 12) shadow++;
  }

  const brightness = sum / lum.length;
  const glareFraction = glare / lum.length;
  const shadowFraction = shadow / lum.length;
  const sharpness = laplacianVariance(lum, width, height);

  const tooBlurry = sharpness < THRESHOLDS.sharpness;
  const hasGlare = glareFraction > THRESHOLDS.glareFraction;
  const tooDark = brightness < THRESHOLDS.darkBrightness || shadowFraction > THRESHOLDS.shadowFraction;

  const warnings: string[] = [];
  if (tooBlurry) {
    warnings.push(
      'The photo is soft. Hold steady, tap to focus, and make sure the card fills the frame — ' +
        'sharpness limits how much can be checked.',
    );
  }
  if (hasGlare) {
    warnings.push(
      `Glare covers about ${Math.round(glareFraction * 100)}% of the card. Angle away from ` +
        'direct light; holo cards are especially prone to this and glare hides detail.',
    );
  }
  if (tooDark) {
    warnings.push('The photo is underexposed. More even, indirect light will improve the analysis.');
  }

  return {
    sharpness: Math.round(sharpness),
    glareFraction: Number(glareFraction.toFixed(4)),
    shadowFraction: Number(shadowFraction.toFixed(4)),
    brightness: Math.round(brightness),
    tooBlurry,
    tooDark,
    hasGlare,
    warnings,
  };
}

/**
 * Variance of the Laplacian: convolve with a 3x3 Laplacian kernel and take the
 * variance of the response. A sharp image has strong edge responses and high
 * variance; a blurred one has little of either.
 */
function laplacianVariance(lum: Float32Array, width: number, height: number): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const response =
        -4 * lum[i]! + lum[i - 1]! + lum[i + 1]! + lum[i - width]! + lum[i + width]!;
      sum += response;
      sumSq += response * response;
      n++;
    }
  }

  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}
