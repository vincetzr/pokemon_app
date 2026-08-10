import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { detectCard, rectifyCard, solveHomography, RECTIFIED_WIDTH, RECTIFIED_HEIGHT } from './rectify';
import { CARD_ASPECT } from '../card-geometry';

const FIXTURES = join(process.cwd(), 'test-fixtures', 'cards');
const hasFixtures = existsSync(join(FIXTURES, 'base1-4.png'));

/** Composite a card onto a contrasting surface to simulate a photo of it. */
async function fakePhoto(id: string, rotate = 0): Promise<Buffer> {
  const card = await sharp(join(FIXTURES, `${id}.png`)).resize({ width: 900 }).toBuffer();
  const surface = { r: 62, g: 52, b: 44 };
  const rotated = rotate
    ? await sharp(card).rotate(rotate, { background: surface }).toBuffer()
    : card;

  return sharp({
    create: { width: 1600, height: 1500, channels: 3, background: surface },
  })
    .composite([{ input: rotated, left: 320, top: 200 }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

describe('solveHomography', () => {
  it('recovers an identity mapping', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 20 },
      { x: 0, y: 20 },
    ];
    const H = solveHomography(pts, pts);
    expect(H[0]).toBeCloseTo(1, 6);
    expect(H[4]).toBeCloseTo(1, 6);
    expect(H[1]).toBeCloseTo(0, 6);
    expect(H[3]).toBeCloseTo(0, 6);
  });

  it('maps a unit square onto a translated, scaled rectangle', () => {
    const src = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const dst = [
      { x: 5, y: 7 },
      { x: 9, y: 7 },
      { x: 9, y: 15 },
      { x: 5, y: 15 },
    ];
    const H = solveHomography(src, dst);

    const project = (p: { x: number; y: number }) => {
      const d = H[6]! * p.x + H[7]! * p.y + H[8]!;
      return { x: (H[0]! * p.x + H[1]! * p.y + H[2]!) / d, y: (H[3]! * p.x + H[4]! * p.y + H[5]!) / d };
    };

    for (let i = 0; i < 4; i++) {
      const got = project(src[i]!);
      expect(got.x).toBeCloseTo(dst[i]!.x, 6);
      expect(got.y).toBeCloseTo(dst[i]!.y, 6);
    }
  });

  it('rejects a degenerate configuration', () => {
    const collapsed = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ];
    expect(() => solveHomography(collapsed, collapsed)).toThrow();
  });
});

describe.skipIf(!hasFixtures)('detectCard', () => {
  it('finds a straight card and measures an aspect close to the official ratio', async () => {
    const photo = await fakePhoto('base1-4');
    const det = await detectCard(photo);

    expect(det.method).toBe('contour');
    expect(det.confidence).toBeGreaterThan(0.5);

    const error = Math.abs(det.measuredAspect - CARD_ASPECT) / CARD_ASPECT;
    expect(error).toBeLessThan(0.05);
  }, 30_000);

  it('still finds the card when it is rotated in frame', async () => {
    const photo = await fakePhoto('base1-4', 8);
    const det = await detectCard(photo);

    expect(det.confidence).toBeGreaterThan(0.3);
    // A rotated card's bounding quad is still card-shaped once corners are taken
    // along the diagonals, so the aspect should not blow up.
    expect(det.measuredAspect).toBeGreaterThan(0.55);
    expect(det.measuredAspect).toBeLessThan(0.95);
  }, 30_000);

  it('handles a modern full-art card with no yellow border', async () => {
    const photo = await fakePhoto('swsh45-18');
    const det = await detectCard(photo);
    expect(det.confidence).toBeGreaterThan(0.3);
  }, 30_000);
});

describe.skipIf(!hasFixtures)('rectifyCard', () => {
  it('produces the canonical rectified size', async () => {
    const photo = await fakePhoto('base1-4');
    const det = await detectCard(photo);
    const rect = await rectifyCard(photo, det.corners);

    expect(rect.width).toBe(RECTIFIED_WIDTH);
    expect(rect.height).toBe(RECTIFIED_HEIGHT);
    expect(rect.data.length).toBe(RECTIFIED_WIDTH * RECTIFIED_HEIGHT * 3);
  }, 30_000);

  it('recovers the card content rather than the surrounding surface', async () => {
    const photo = await fakePhoto('base1-4');
    const det = await detectCard(photo);
    const rect = await rectifyCard(photo, det.corners);

    // Base Set Charizard has a saturated yellow border. Sample the rectified
    // border ring: it should be yellow, which proves we cropped to the card and
    // not to the brown surface behind it.
    const { data, width, height } = rect;
    let r = 0, g = 0, b = 0, n = 0;
    const band = Math.round(height * 0.02);
    for (let y = band; y < band * 2; y++) {
      for (let x = Math.round(width * 0.2); x < Math.round(width * 0.8); x++) {
        const i = (y * width + x) * 3;
        r += data[i]!; g += data[i + 1]!; b += data[i + 2]!; n++;
      }
    }
    r /= n; g /= n; b /= n;

    expect(r).toBeGreaterThan(150);
    expect(g).toBeGreaterThan(120);
    expect(b).toBeLessThan(r * 0.75);
  }, 30_000);
});
