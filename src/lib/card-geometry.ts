/**
 * Physical geometry of a Pokemon TCG card, and the resolution arithmetic that
 * decides which authenticity checks are allowed to run.
 *
 * The numbers here are load-bearing: several signals abstain based on them, and
 * abstaining correctly is what stops the app from accusing a genuine card.
 */

/** Official trading-card dimensions in millimetres (the standard "poker" size). */
export const CARD_WIDTH_MM = 63;
export const CARD_HEIGHT_MM = 88;

/** Width / height = 0.71591. */
export const CARD_ASPECT = CARD_WIDTH_MM / CARD_HEIGHT_MM;

/**
 * How far a card's measured aspect ratio may sit from the official value before
 * it counts as suspicious.
 *
 * Calibration note: this is deliberately generous. Measured against official
 * scans, modern card images land within 0.12% of the true aspect while vintage
 * Base Set scans sit 1.6% off — not because the cards are wrong, but because
 * the scans are cropped differently. A user's photo adds perspective error on
 * top. Anything under ~3% is therefore noise, and only a gross deviation is
 * evidence of a miscut or a wrongly-sized counterfeit.
 */
export const ASPECT_TOLERANCE = {
  /** Within this, the geometry is unremarkable. */
  nominal: 0.03,
  /** Beyond this, flag it — but a genuine miscut can also land here. */
  suspicious: 0.06,
};

/**
 * Minimum pixels across the card's 63mm width for each analysis tier.
 *
 * Derived rather than guessed: genuine cards are offset-printed with a halftone
 * screen around 133–175 LPI. Across a 2.48in card that is 330–434 rosette cycles;
 * Nyquist alone needs 2px per cycle and reliable detection needs about 4px, so
 * resolving the screen requires roughly 1300–1750px across the card. Below that
 * the print signal cannot run and must abstain instead of scoring.
 */
export const RESOLUTION_TIERS = {
  /** Enough to identify the card and read its text. */
  identify: 500,
  /** Enough for geometry, colour, and layout comparison. */
  compare: 900,
  /** Enough to resolve the halftone screen for print analysis. */
  print: 1400,
} as const;

export type ResolutionTier = keyof typeof RESOLUTION_TIERS;

/** Pixels across the card's short edge, given the card's bounding box in an image. */
export function effectiveCardResolution(box: { width: number; height: number }): number {
  // Use the short edge regardless of orientation.
  return Math.min(box.width, box.height);
}

export function meetsTier(box: { width: number; height: number }, tier: ResolutionTier): boolean {
  return effectiveCardResolution(box) >= RESOLUTION_TIERS[tier];
}

/** Halftone screen frequencies used in offset printing, for the FFT search band. */
export const HALFTONE_LPI_RANGE = { min: 120, max: 200 };

/**
 * Convert a halftone frequency in lines-per-inch into cycles-per-pixel, given
 * how many pixels the card's 63mm width occupies. Used to place the FFT search
 * band for the print signal.
 */
export function lpiToCyclesPerPixel(lpi: number, cardWidthPx: number): number {
  const cardWidthInches = CARD_WIDTH_MM / 25.4;
  const cyclesAcrossCard = lpi * cardWidthInches;
  return cyclesAcrossCard / cardWidthPx;
}

/**
 * Normalised layout regions, as fractions of the card's width and height with
 * the origin at the top-left of the trimmed card.
 *
 * These are approximate and era-dependent — modern full-art and Scarlet & Violet
 * layouts differ substantially from WOTC-era cards. They are used to target
 * sampling (where to look for the border, where the copyright line sits), never
 * to assert that a card is fake because something is a few percent out of place.
 */
export const REGIONS = {
  /** The outer frame. On most cards yellow, but full-arts and modern SV cards vary. */
  borderRing: { inset: 0.008, thickness: 0.018 },
  /** Card name, top of the card. */
  nameBar: { x: 0.08, y: 0.045, width: 0.62, height: 0.06 },
  /** HP and type icons, top right. */
  hpBar: { x: 0.70, y: 0.045, width: 0.24, height: 0.055 },
  /** Main illustration window — the region that should be holo on a holo card. */
  artWindow: { x: 0.09, y: 0.11, width: 0.82, height: 0.42 },
  /** Attack and ability text. */
  bodyText: { x: 0.10, y: 0.58, width: 0.80, height: 0.26 },
  /** Bottom strip carrying the illustrator credit, copyright line, and collector number. */
  footer: { x: 0.06, y: 0.90, width: 0.88, height: 0.07 },
  /** Set symbol and collector number, bottom right on most eras. */
  setSymbol: { x: 0.62, y: 0.905, width: 0.32, height: 0.05 },
} as const;

export type RegionName = keyof typeof REGIONS;

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Resolve a normalised region to pixel coordinates within a rectified card image. */
export function regionToPixels(
  region: { x: number; y: number; width: number; height: number },
  card: { width: number; height: number },
): PixelRect {
  return {
    x: Math.round(region.x * card.width),
    y: Math.round(region.y * card.height),
    width: Math.round(region.width * card.width),
    height: Math.round(region.height * card.height),
  };
}

/** Clamp a rect so it stays inside the image, guarding against rounding overflow. */
export function clampRect(rect: PixelRect, bounds: { width: number; height: number }): PixelRect {
  const x = Math.max(0, Math.min(rect.x, bounds.width - 1));
  const y = Math.max(0, Math.min(rect.y, bounds.height - 1));
  return {
    x,
    y,
    width: Math.max(1, Math.min(rect.width, bounds.width - x)),
    height: Math.max(1, Math.min(rect.height, bounds.height - y)),
  };
}
