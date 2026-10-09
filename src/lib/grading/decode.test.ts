import { describe, expect, it } from 'vitest';
import bwip from 'bwip-js/node';
import sharp from 'sharp';
import { decodePixels } from './decode';
import { certificateFromBarcode } from './rules';
import { inspectBackPixels } from './photo';

describe('real QR and 1D image decoding', () => {
  for (const [bcid, text, format] of [['qrcode', 'https://www.psacard.com/cert/00123456', 'QR_CODE'], ['code128', '00123456', 'CODE_128'], ['code39', '00123456', 'CODE_39'], ['interleaved2of5', '00123456', 'ITF'], ['datamatrix', '00123456', 'DATA_MATRIX'], ['pdf417', '00123456', 'PDF_417']]) {
    it('decodes ' + format + ' from actual image pixels', async () => {
      const png = await bwip.toBuffer({ bcid: bcid!, text: text!, scale: 4, ...(['code128', 'code39', 'interleaved2of5'].includes(bcid!) ? { height: 18 } : {}), padding: 12, backgroundcolor: 'FFFFFF' });
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const read = decodePixels(data, info.width, info.height);
      expect(read).toEqual({ text, format });
      expect(certificateFromBarcode(read!, 'PSA')).toEqual({ company: 'PSA', cert: '00123456' });
    });
  }
  it('does not invent a code on a blank image', () => { expect(decodePixels(new Uint8Array(800 * 1000 * 4).fill(255), 800, 1000)).toBe(null); });
});
describe('back whitening screening', () => {
  it('abstains on low resolution and a white/glared crop', () => {
    expect(inspectBackPixels(new Uint8Array(100 * 140 * 4).fill(255), 100, 140).usable).toBe(false);
    expect(inspectBackPixels(new Uint8Array(630 * 880 * 4).fill(255), 630, 880).usable).toBe(false);
  });
  it('estimates visible back-border whitening and leaves surface to review', () => {
    const w = 630, h = 880, data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, variation = (x + y) % 20;
      data[i] = 20 + variation; data[i + 1] = 40 + variation; data[i + 2] = 120 + variation; data[i + 3] = 255;
      if (x >= 7 && x < 20 && y > 300 && y < 430) data[i] = data[i + 1] = data[i + 2] = 230;
    }
    const result = inspectBackPixels(data, w, h);
    expect(result.usable).toBe(true); expect(result.edges).not.toBe('none'); expect(result.note).toMatch(/review/i);
  });
});
