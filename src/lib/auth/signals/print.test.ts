import { describe, expect, it } from 'vitest';
import { printSignal } from './print';
import type { RawImage } from '../../image/rectify';
import { RESOLUTION_TIERS } from '../../card-geometry';

/**
 * Build a synthetic rectified card carrying a sinusoidal "print screen" at a
 * known frequency, so we can check the detector responds to real periodic
 * structure and not to noise.
 */
function syntheticCard(opts: {
  width: number;
  height: number;
  /** Screen frequency in cycles per pixel. 0 disables the screen. */
  frequency: number;
  amplitude?: number;
  base?: number;
  noise?: number;
}): RawImage {
  const { width, height, frequency, amplitude = 18, base = 140, noise = 0 } = opts;
  const data = Buffer.alloc(width * height * 3);

  // Deterministic pseudo-random so the test does not flake.
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // A rosette is a 2D pattern; a product of two sinusoids approximates the
      // periodic concentration well enough to test the detector.
      const screen =
        frequency > 0
          ? Math.cos(2 * Math.PI * frequency * x) * Math.cos(2 * Math.PI * frequency * y)
          : 0;
      const v = Math.max(0, Math.min(255, base + screen * amplitude + rand() * noise));
      const i = (y * width + x) * 3;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    }
  }

  return { data, width, height, channels: 3 };
}

describe('printSignal', () => {
  it('abstains rather than scoring when resolution is too low', () => {
    const img = syntheticCard({ width: 800, height: 1117, frequency: 0.1 });
    const signal = printSignal(img, RESOLUTION_TIERS.print - 200);

    expect(signal.status).toBe('insufficient_data');
    expect(signal.score).toBeNull();
    expect(signal.reason).toContain('pixels across the card');
  });

  it('runs when resolution is sufficient', () => {
    const img = syntheticCard({ width: 1500, height: 2095, frequency: 0.1 });
    const signal = printSignal(img, 1500);

    expect(signal.status).toBe('ok');
    expect(signal.score).not.toBeNull();
  });

  it('scores a card carrying a halftone-band screen above one with none', () => {
    const cardWidthPx = 1500;
    const width = 1500;
    const height = 2095;

    // 150 LPI across a 2.48in card spanning 1500px works out to ~0.248 cycles
    // per pixel, which sits inside the 120-200 LPI search band.
    const withScreen = printSignal(
      syntheticCard({ width, height, frequency: 0.248, noise: 3 }),
      cardWidthPx,
    );
    const flat = printSignal(
      syntheticCard({ width, height, frequency: 0, noise: 3 }),
      cardWidthPx,
    );

    expect(withScreen.status).toBe('ok');
    expect(flat.status).toBe('ok');
    expect(withScreen.score!).toBeGreaterThan(flat.score!);
  });

  it('does not credit a screen that falls outside the halftone band', () => {
    const cardWidthPx = 1500;
    // A very low frequency gradient is not a print screen.
    const outOfBand = printSignal(
      syntheticCard({ width: 1500, height: 2095, frequency: 0.01, noise: 3 }),
      cardWidthPx,
    );
    const inBand = printSignal(
      syntheticCard({ width: 1500, height: 2095, frequency: 0.248, noise: 3 }),
      cardWidthPx,
    );

    expect(inBand.score!).toBeGreaterThan(outOfBand.score!);
  });

  it('reports the measurements it based the score on', () => {
    const signal = printSignal(syntheticCard({ width: 1500, height: 2095, frequency: 0.248 }), 1500);
    expect(signal.measurements.screenEnergyRatio).toBeTypeOf('number');
    expect(signal.measurements.patchesAnalysed).toBeGreaterThan(0);
    expect(signal.measurements.searchBandLpi).toBe('120-200');
  });
});
