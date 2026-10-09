import type { Wear } from './rules';
export interface BackWear { edges: Wear; corners: Wear; whiteningFraction: number | null; usable: boolean; note: string }

/** Advisory only: inspect whitening against the dark-blue border of an
 * upright, tightly cropped English Pokémon back. Never inspect the artwork. */
export function inspectBackPixels(data: Uint8Array | Uint8ClampedArray, width: number, height: number, channels = 4): BackWear {
  const abstain = (note: string): BackWear => ({ edges: 'unknown', corners: 'unknown', whiteningFraction: null, usable: false, note });
  if (width < 600 || height < 800 || Math.abs(width / height - 63 / 88) > .035) return abstain('Use a sharp, tightly cropped back photo at least 600 pixels wide.');
  let total = 0, blue = 0, white = 0, corners = 0, cornerWhite = 0, sum = 0, variance = 0;
  for (let y = Math.round(height * .008); y < height * .992; y++) for (let x = Math.round(width * .008); x < width * .992; x++) {
    const edge = x < width * .045 || x > width * .955 || y < height * .032 || y > height * .968;
    if (!edge) continue;
    const i = (y * width + x) * channels, r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    const light = (r + g + b) / 3;
    const isWhite = Math.min(r, g, b) > 185 && Math.max(r, g, b) - Math.min(r, g, b) < 40;
    total++; sum += light; variance += light * light;
    if (b > r * 1.2 && b > g * 1.07 && b > 55) blue++;
    if (isWhite) white++;
    if ((x < width * .1 || x > width * .9) && (y < height * .1 || y > height * .9)) { corners++; if (isWhite) cornerWhite++; }
  }
  if (!total || blue / total < .52 || sum / total < 35) return abstain('The crop does not show a clear blue Pokémon back border. Check the frame, sleeve and lighting.');
  if (white / total > .25 || variance / total - (sum / total) ** 2 < 15) return abstain('Glare, severe wear or softness makes whitening unreliable. Inspect the card manually.');
  const wear = (fraction: number): Wear => fraction > .10 ? 'heavy' : fraction > .025 ? 'moderate' : fraction > .003 ? 'minor' : 'none';
  return { edges: wear(white / total), corners: wear(cornerWhite / Math.max(corners, 1)), whiteningFraction: white / total,
    usable: true, note: 'Photo estimate from back-border whitening only. Glare and crop errors can resemble wear; review both sides, surface and creases.' };
}
