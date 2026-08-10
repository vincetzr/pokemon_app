import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { assessQuality } from './quality';
import { RECTIFIED_HEIGHT, RECTIFIED_WIDTH, type RawImage } from './rectify';

const FIXTURES = join(process.cwd(), 'test-fixtures', 'cards');
const hasFixtures = existsSync(join(FIXTURES, 'base1-4.png'));

async function rectifiedRaw(buf: Buffer): Promise<RawImage> {
  const { data, info } = await sharp(buf)
    .resize(RECTIFIED_WIDTH, RECTIFIED_HEIGHT, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: 3 };
}

describe.skipIf(!hasFixtures)('assessQuality', () => {
  /**
   * The regression that matters most: a vintage card's official scan is
   * legitimately much softer than a modern one, and an earlier threshold
   * flagged the genuine Base Set Charizard reference as too blurry. Any
   * threshold change that reintroduces that must fail here.
   */
  it('does not flag genuine card images as blurry, across eras', async () => {
    for (const id of ['base1-4', 'swsh45-18', 'sv3pt5-6']) {
      const img = await rectifiedRaw(await sharp(join(FIXTURES, `${id}.png`)).toBuffer());
      const q = await assessQuality(img);
      expect(q.tooBlurry, `${id} was wrongly flagged as blurry (sharpness ${q.sharpness})`).toBe(false);
    }
  }, 30_000);

  it('flags genuinely blurred captures', async () => {
    for (const id of ['base1-4', 'swsh45-18', 'sv3pt5-6']) {
      const blurred = await sharp(join(FIXTURES, `${id}.png`)).blur(3).toBuffer();
      const q = await assessQuality(await rectifiedRaw(blurred));
      expect(q.tooBlurry, `${id} blurred was not flagged`).toBe(true);
      expect(q.warnings.join(' ')).toContain('soft');
    }
  }, 30_000);

  it('detects blown-out glare', async () => {
    const blown = await sharp(join(FIXTURES, 'base1-4.png')).modulate({ brightness: 1.9 }).toBuffer();
    const q = await assessQuality(await rectifiedRaw(blown));
    expect(q.hasGlare).toBe(true);
    expect(q.warnings.join(' ')).toContain('Glare');
  }, 30_000);

  it('detects underexposure', async () => {
    const dark = await sharp(join(FIXTURES, 'base1-4.png')).modulate({ brightness: 0.4 }).toBuffer();
    const q = await assessQuality(await rectifiedRaw(dark));
    expect(q.tooDark).toBe(true);
  }, 30_000);

  it('does not flag a legitimately dark full-art card as underexposed', async () => {
    // Cinderace V has a dark frame; a naive shadow check would call it underexposed.
    const img = await rectifiedRaw(await sharp(join(FIXTURES, 'swsh45-18.png')).toBuffer());
    const q = await assessQuality(img);
    expect(q.tooDark).toBe(false);
  }, 30_000);
});
