/**
 * Genuine-card reference data, and the catalogue of tests we deliberately do
 * NOT ship.
 *
 * This file is the authenticity engine's factual foundation. It exists as data
 * rather than as prose scattered through signal code so that era rules can be
 * corrected without touching detection logic, and so the reasons a test was
 * rejected survive longer than the person who rejected it.
 *
 * Sourced from grading-company documentation (PSA, CGC, Beckett), authenticator
 * material, and direct measurement of official card renders. Where the research
 * found the community claim to be wrong, the wrong claim is recorded in
 * DEBUNKED below with the reason — because "we already looked at that and it
 * causes false accusations" is exactly the knowledge that otherwise gets
 * rediscovered and re-shipped.
 */

// ---------------------------------------------------------------------------
// Physical invariants (all eras, all languages)
// ---------------------------------------------------------------------------

export const PHYSICAL = {
  /** Unchanged since 1996, and identical for every language including Japanese. */
  widthMm: 63.0,
  heightMm: 88.0,
  /**
   * Corner die radius. Spec is 3.175mm, but measured genuine renders span
   * 2.49–3.01mm, so only asymmetry BETWEEN a card's four corners is meaningful.
   */
  cornerRadiusMm: { spec: 3.175, genuineBand: [2.3, 3.6] as const },
  /**
   * Offset lithography, CMYK halftone. No manufacturer LPI figure is published;
   * this range is inferred from premium coated-stock offset practice, so it must
   * never be tested against a specific value.
   */
  screenRulingLpi: [133, 200] as const,
} as const;

/** Eras, in order. Layout, fonts and symbols changed substantially between them. */
export type Era = 'WOTC' | 'EX' | 'DP_HGSS' | 'BW_XY' | 'SM' | 'SWSH' | 'SV';

export interface EraProfile {
  era: Era;
  label: string;
  from: number;
  to: number | null;
  /** Median border colour sampled from official renders. */
  borderRgb: [number, number, number] | null;
  borderNote: string;
  /** Border width at mid-height, in millimetres. */
  borderWidthMm: [number, number];
  /**
   * `HP 60` (prefix) vs `60 HP` (suffix). The single cleanest discriminator
   * between pre- and post-2007 layouts.
   */
  hpFormat: 'suffix' | 'prefix';
  hpColour: 'red' | 'black';
  /** Regex the printed copyright line should satisfy for this era. */
  copyrightPattern: RegExp;
  setSymbolPosition: 'info-bar-right' | 'bottom-right' | 'bottom-left' | 'expansion-code-box' | 'none';
  rarityPosition: 'bottom-right' | 'bottom-left';
  holoPattern: string;
  textured: boolean;
}

export const ERAS: readonly EraProfile[] = [
  {
    era: 'WOTC',
    label: 'Wizards of the Coast',
    from: 1999,
    to: 2003,
    borderRgb: [0xec, 0xce, 0x13],
    borderNote: 'Yellow. Base #ECCE13–#F2D20D; Jungle/Neo #F7CC00.',
    borderWidthMm: [1.7, 2.4],
    hpFormat: 'suffix',
    hpColour: 'red',
    copyrightPattern: /©\s*1995[,\s]*96[,\s]*98/i,
    // English Base Set genuinely has NO set symbol — its absence identifies it.
    setSymbolPosition: 'info-bar-right',
    rarityPosition: 'bottom-right',
    holoPattern: 'Starlight (Base/Jungle/Fossil), then Cosmos from Base Set 2',
    textured: false,
  },
  {
    era: 'EX',
    label: 'EX series',
    from: 2003,
    to: 2007,
    borderRgb: [0xeb, 0xd4, 0x51],
    borderNote: 'Yellow #EBD451–#FCDE2A.',
    borderWidthMm: [1.1, 1.4],
    hpFormat: 'suffix',
    hpColour: 'black',
    copyrightPattern: /©\s*200[3-7]\s*Pok[eé]mon/i,
    setSymbolPosition: 'bottom-right',
    rarityPosition: 'bottom-right',
    holoPattern: 'Cosmos',
    textured: false,
  },
  {
    era: 'DP_HGSS',
    label: 'Diamond & Pearl through HeartGold SoulSilver',
    from: 2007,
    to: 2010,
    borderRgb: [0xfa, 0xf2, 0x5d],
    borderNote: 'Palest, greenest yellow. DP #FAF25D, HGSS #F7E384.',
    borderWidthMm: [0.7, 1.4],
    hpFormat: 'prefix',
    hpColour: 'black',
    copyrightPattern: /©\s*20(0[7-9]|10)\s*Pok[eé]mon/i,
    setSymbolPosition: 'bottom-right',
    rarityPosition: 'bottom-right',
    holoPattern: 'Cosmos',
    textured: false,
  },
  {
    era: 'BW_XY',
    label: 'Black & White through XY',
    from: 2011,
    to: 2016,
    borderRgb: [0xff, 0xe5, 0x57],
    borderNote: 'Brightest yellow #FFE557.',
    borderWidthMm: [2.6, 2.8],
    hpFormat: 'prefix',
    hpColour: 'black',
    copyrightPattern: /©\s*201[1-6]\s*Pok[eé]mon/i,
    setSymbolPosition: 'bottom-right',
    rarityPosition: 'bottom-right',
    holoPattern: 'Tinsel (BW), then Sheen (XY)',
    textured: true, // from Next Destinies, 2012
  },
  {
    era: 'SM',
    label: 'Sun & Moon',
    from: 2017,
    to: 2019,
    borderRgb: [0xff, 0xe1, 0x63],
    borderNote: 'Yellow #FFE163.',
    borderWidthMm: [2.4, 2.6],
    hpFormat: 'prefix',
    hpColour: 'black',
    copyrightPattern: /©\s*201[7-9]\s*Pok[eé]mon/i,
    // Set symbol and rarity moved to the LEFT from Sun & Moon onward.
    setSymbolPosition: 'bottom-left',
    rarityPosition: 'bottom-left',
    holoPattern: 'Water Web',
    textured: true,
  },
  {
    era: 'SWSH',
    label: 'Sword & Shield',
    from: 2020,
    to: 2022,
    borderRgb: [0xff, 0xe1, 0x65],
    borderNote: 'Yellow #FFE165.',
    borderWidthMm: [2.4, 2.5],
    hpFormat: 'prefix',
    hpColour: 'black',
    copyrightPattern: /©\s*202[0-2]\s*Pok[eé]mon/i,
    setSymbolPosition: 'bottom-left',
    rarityPosition: 'bottom-left',
    holoPattern: 'Line (thin vertical)',
    textured: true,
  },
  {
    era: 'SV',
    label: 'Scarlet & Violet',
    from: 2023,
    to: null,
    // Silver, not yellow. A yellow-border expectation fails every modern card.
    borderRgb: [0xce, 0xce, 0xd0],
    borderNote: 'SILVER/GREY #CECED0–#D3D4D6, not yellow.',
    borderWidthMm: [2.4, 2.5],
    hpFormat: 'prefix',
    hpColour: 'black',
    copyrightPattern: /©\s*202[3-9]\s*Pok[eé]mon/i,
    setSymbolPosition: 'expansion-code-box',
    rarityPosition: 'bottom-left',
    holoPattern: 'Mirage (horizontal refraction)',
    textured: true,
  },
] as const;

/** Infer the era from a set's release date. */
export function eraForReleaseDate(releaseDate: string): EraProfile | null {
  const year = Number(releaseDate.slice(0, 4));
  if (!Number.isFinite(year)) return null;
  return ERAS.find((e) => year >= e.from && (e.to === null || year <= e.to)) ?? null;
}

/**
 * Regulation marks, introduced with Sword & Shield in 2020. Their ABSENCE on
 * any pre-2020 card is correct and must never be treated as a concern.
 */
export const REGULATION_MARKS: Record<string, number> = {
  D: 2020, E: 2021, F: 2022, G: 2023, H: 2024, I: 2025, J: 2026,
};

/**
 * Legitimate non-standard card backs. These must be classified BEFORE any
 * comparison against the standard blue back, or each one reads as counterfeit.
 */
export const LEGITIMATE_ALTERNATE_BACKS: readonly string[] = [
  'Japanese "Pocket Monster Card Game" old back (1996 – Nov 2001)',
  'Japanese new back (Dec 2001 onward)',
  'Japanese Vending Series (1998) — seven distinct backs',
  'Trainer Deck A / B (1999)',
  'Ancient Mew (2000) — holofoil on BOTH sides',
  'World Championship decks — a unique back for each year since 2004',
] as const;

// ---------------------------------------------------------------------------
// Tests we deliberately do not ship
// ---------------------------------------------------------------------------

export interface DebunkedTest {
  claim: string;
  status: 'FOLKLORE' | 'OBSOLETE' | 'SCOPE_ERROR' | 'MEASURED_DEAD' | 'HARMFUL';
  why: string;
}

/**
 * Every entry here is a test that a plausible-sounding implementation would
 * ship, and that would accuse genuine cards. Kept in code so the reasoning is
 * not rediscovered and re-shipped.
 */
export const DEBUNKED: readonly DebunkedTest[] = [
  {
    claim: 'Absolute colour difference (CIEDE2000) against the official artwork',
    status: 'MEASURED_DEAD',
    why:
      'Three genuine Base Set cards\' yellow borders, sampled from the official renders with ' +
      'within-card SD of only 2.3–4.0 RGB units, differ from each other by ΔE00 1.34, 3.57 and ' +
      '3.96 — genuine versus genuine, same set, no camera involved, already above the 2.0–2.3 ' +
      'just-noticeable band. Uncorrected phone white balance adds 8–15 ΔE00 and is only 65–70% ' +
      'correctable, and only with a colour chart in frame. The genuine noise floor is at least ' +
      '12 ΔE00, so no threshold separates real from fake. There is no operating point.',
  },
  {
    claim: 'A halftone rosette proves the card is genuine',
    status: 'OBSOLETE',
    why:
      'Backwards on both sides. Counterfeits are CMYK-printed too, and 2025 CGC alerts confirm ' +
      'offset-press fakes — "even most fakes have a rosette pattern". Conversely, phone ' +
      'multi-frame noise reduction, JPEG chroma subsampling and mild defocus each erase a ' +
      '133–175 LPI screen from a genuine card. Usable only one-sided, capped, and narrowed to ' +
      'spot-colour regions.',
  },
  {
    claim: 'Off-centre or miscut cards are fake',
    status: 'FOLKLORE',
    why:
      '60/40 centring is within normal manufacturing tolerance. PSA has a dedicated N8 no-grade ' +
      'for manufacturer miscuts and does not charge for it, and severe miscuts sell at a premium. ' +
      'Measured on a genuine Base Set scan: 2.00mm left border against 1.68mm right. This is a ' +
      'condition attribute, never an authenticity one.',
  },
  {
    claim: 'Print lines or roller lines indicate a fake',
    status: 'FOLKLORE',
    why:
      'Offset-lithography artifacts present on authentic cards from every era — XY Evolutions is ' +
      'notorious, and SWSH-era Vivid Voltage and Chilling Reign are bad for it. It is the single ' +
      'most common reason a genuine card grades PSA 9 instead of 10.',
  },
  {
    claim: 'A collector number higher than the set total means a fake',
    status: 'FOLKLORE',
    why:
      'Secret rares, hyper rares, illustration rares and gold cards are numbered above the printed ' +
      'total by design, from Dark Raichu in Team Rocket onward. This rule condemns the most ' +
      'valuable genuine cards in nearly every modern set.',
  },
  {
    claim: 'A missing set symbol or rarity symbol means a fake',
    status: 'FOLKLORE',
    why:
      'English Base Set genuinely has no set symbol — its absence is a positive identifier. Basic ' +
      'Energy, Black Star Promos and World Championship cards also legitimately lack symbols or ' +
      'rarity marks.',
  },
  {
    claim: 'HP is printed in red',
    status: 'SCOPE_ERROR',
    why:
      'True only from 1999 to 2003. EX-era HP is black, and from Diamond & Pearl (2007) the format ' +
      'flips to an "HP 60" prefix. This rule fails every card made since 2003.',
  },
  {
    claim: 'Brighter or more vivid colour means a fake',
    status: 'FOLKLORE',
    why:
      'Shadowless Base Set cards genuinely read brighter and more vividly than Unlimited, with a ' +
      'thinner HP font. A naive saturation threshold accuses the most valuable print run in the hobby.',
  },
  {
    claim: 'A card with no drop shadow is fake',
    status: 'SCOPE_ERROR',
    why:
      'Base Set 1st Edition and Shadowless genuinely have none; the shadow arrived with Unlimited. ' +
      'And Jungle and Fossil 1st Editions legitimately DO have drop shadows, so the related ' +
      '"1st Edition stamp plus drop shadow" rule applies to English Base Set only.',
  },
  {
    claim: 'Whole-card holo means a fake',
    status: 'FOLKLORE',
    why:
      'Reverse holos foil the body, Cracked Ice foils the body excluding art, SV Mirage foils the ' +
      'silver borders, and Full Art / VMAX / VSTAR / ex / gold / rainbow / textured cards are ' +
      'edge-to-edge by design. The surviving narrow form applies to under 5% of scans while the ' +
      'cost of getting it wrong is accusing roughly a third of every modern collection.',
  },
  {
    claim: 'Genuine cards weigh 1.75g, or are 0.30–0.33mm thick',
    status: 'FOLKLORE',
    why:
      'No grading company publishes a weight or thickness spec. PSA states that even the same card ' +
      'from the same set and parallel can differ in thickness. Genuine mass moves with era, stock ' +
      'changes, foil, texture, language and humidity by more than the claimed margin, and modern ' +
      'counterfeits are deliberately weight-matched.',
  },
  {
    claim: 'Japanese cards are 59×86mm',
    status: 'FOLKLORE',
    why:
      'That is Yu-Gi-Oh, copy-pasted into Pokemon size guides. Japanese Pokemon cards are 63×88mm ' +
      'like every other language. Shipping this size-flags every genuine Japanese card.',
  },
  {
    claim: 'The light test decides whether a card is genuine',
    status: 'OBSOLETE',
    why:
      'Fails in both directions. 2024–2026 counterfeits laminate a dark core, and glued-front fakes ' +
      'contain a genuine card so are MORE opaque. Meanwhile thin genuine Japanese stock, textured ' +
      'special illustration rares, heavy foils and double-sided-foil Ancient Mew all "fail" it. ' +
      'Useful only as a one-way in-hand screen.',
  },
  {
    claim: 'The rip test',
    status: 'HARMFUL',
    why:
      'Destroys the asset being evaluated. Every other core check yields the same information ' +
      'without damage, and neither PSA nor CGC uses it.',
  },
  {
    claim: 'A valid cert number or a scannable QR proves a slab is genuine',
    status: 'OBSOLETE',
    why:
      'Cert-number cloning is the dominant slab fraud of 2024–2026, and the QR merely encodes the ' +
      'cert number. Only an image match against the grader\'s own scan closes the loop.',
  },
  {
    claim: 'A card that failed grading is counterfeit',
    status: 'SCOPE_ERROR',
    why:
      'This collapses PSA\'s taxonomy. N1 trimming, N2 restoration, N3 recolouration, N5 altered ' +
      'stock and N7 cleaning are all GENUINE but altered. N6 undersize, N8 manufacturer miscut and ' +
      'N9 obscure are not even charged for. Only N4 is questionable authenticity.',
  },
  {
    claim: 'A back-side check can confirm the front',
    status: 'OBSOLETE',
    why:
      'CGC documented a counterfeit whose fake front was printed onto a genuine Magic: The ' +
      'Gathering card, so every back-side test passed and the plate angles matched genuine exactly. ' +
      'A passing back check must never raise confidence in the front.',
  },
] as const;

/**
 * Legitimate variation that must be classified before any signal scores. Each
 * of these makes a genuine card look "wrong" to a naive comparison.
 */
export const LEGITIMATE_VARIATION: readonly string[] = [
  'Off-centre cuts, miscuts and factory print lines — ordinary quality-control variation',
  'Wear: edge and corner whitening, scratches, creases, sun-fading, indentations',
  'Non-English printings, which differ in layout, fonts, text placement and back design',
  'Print runs: 1st Edition, Shadowless, Unlimited, and the UK 4th print',
  'League, Prerelease and staff stamps; World Championship cards, which state in printed text that they are not tournament legal',
  'Genuine error cards and ink hickeys, catalogued by name and often collectible',
  'Photography artifacts: holo glare, indoor colour cast, HDR tone-mapping, sleeve reflections, screen moire',
] as const;
