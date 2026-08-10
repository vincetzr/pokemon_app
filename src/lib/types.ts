/**
 * Core domain types.
 *
 * The single most important invariant in this file: every monetary figure the
 * app can display carries a `provenance` describing where it came from. The UI
 * is required to render `modeled` figures differently from observed ones. An
 * estimate must never be presentable as an observation.
 */

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/** A Pokemon TCG card, normalised from the Pokemon TCG API v2. */
export interface Card {
  /** API id, e.g. "base1-4". Stable and globally unique. */
  id: string;
  name: string;
  /** Printed collector number, e.g. "4" or "SV107". Not necessarily numeric. */
  number: string;
  set: CardSet;
  rarity: string | null;
  supertype: string | null;
  subtypes: string[];
  artist: string | null;
  images: {
    small: string;
    large: string;
  };
  /** Printings this card exists in, e.g. ["holofoil"] or ["normal","reverseHolofoil"]. */
  variants: PrintVariant[];
}

export interface CardSet {
  id: string;
  name: string;
  series: string;
  /** Number printed on the card, e.g. 102 in "4/102". */
  printedTotal: number;
  /** Actual total including secret rares. */
  total: number;
  releaseDate: string;
  images: {
    symbol: string;
    logo: string;
  };
}

/**
 * TCGplayer's printing/variant keys. These are the real keys observed in the
 * API; a card exposes prices only for the variants it was actually printed in.
 */
export type PrintVariant =
  | 'normal'
  | 'holofoil'
  | 'reverseHolofoil'
  | '1stEditionNormal'
  | '1stEditionHolofoil'
  | 'unlimitedHolofoil'
  | 'unlimited';

export const PRINT_VARIANTS: readonly PrintVariant[] = [
  'normal',
  'holofoil',
  'reverseHolofoil',
  '1stEditionNormal',
  '1stEditionHolofoil',
  'unlimitedHolofoil',
  'unlimited',
] as const;

// ---------------------------------------------------------------------------
// Condition
// ---------------------------------------------------------------------------

/**
 * Raw (ungraded) condition ladder. This is TCGplayer's ladder, which is the de
 * facto standard for US singles. Cardmarket's 7-step ladder is mapped onto it
 * in `conditions.ts` — that mapping is lossy and is documented there.
 */
export type RawCondition = 'NM' | 'LP' | 'MP' | 'HP' | 'DMG';

export const RAW_CONDITIONS: readonly RawCondition[] = ['NM', 'LP', 'MP', 'HP', 'DMG'] as const;

/** Professional grading services we model. */
export type GradingCompany = 'PSA' | 'BGS' | 'CGC';

/** A professionally graded slab, e.g. { company: 'PSA', grade: 10 }. */
export interface GradedCondition {
  company: GradingCompany;
  /** 1–10. BGS/CGC allow half grades (9.5); PSA does not except for the rare 1.5. */
  grade: number;
}

/** Either a raw condition or a graded slab. */
export type Condition =
  | { kind: 'raw'; condition: RawCondition }
  | { kind: 'graded'; graded: GradedCondition };

export function conditionKey(c: Condition): string {
  return c.kind === 'raw' ? `raw:${c.condition}` : `graded:${c.graded.company}${c.graded.grade}`;
}

export function conditionLabel(c: Condition): string {
  if (c.kind === 'raw') return RAW_CONDITION_LABELS[c.condition];
  return `${c.graded.company} ${c.graded.grade}`;
}

export const RAW_CONDITION_LABELS: Record<RawCondition, string> = {
  NM: 'Near Mint',
  LP: 'Lightly Played',
  MP: 'Moderately Played',
  HP: 'Heavily Played',
  DMG: 'Damaged',
};

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/**
 * Where a number came from. This drives how the UI renders it, and it is the
 * mechanism that stops an estimate from masquerading as an observation.
 *
 *  - `observed`   A price a marketplace actually reported for this exact card
 *                 and variant. Solid lines. Trustworthy.
 *  - `recorded`   An `observed` price this app captured itself at a known time
 *                 and persisted. Genuine history that accrues as the app runs.
 *  - `backfilled` Real historical data from a third-party paid source. Real,
 *                 but from a vendor we did not observe directly. Dashed lines.
 *  - `modeled`    Computed by us — e.g. a Near Mint price scaled by a condition
 *                 multiplier. NOT an observation. Must always render as a band
 *                 or shaded region with an explicit "estimate" label, never as
 *                 a bare number implying a real sale.
 */
export type Provenance = 'observed' | 'recorded' | 'backfilled' | 'modeled';

export const PROVENANCE_IS_REAL: Record<Provenance, boolean> = {
  observed: true,
  recorded: true,
  backfilled: true,
  modeled: false,
};

/** Marketplaces we read prices from. */
export type PriceSource = 'tcgplayer' | 'cardmarket' | 'pricecharting';

/** A single money figure with full attribution. Currency is explicit — TCGplayer
 *  reports USD and Cardmarket reports EUR, and conflating them is a real bug. */
export interface Money {
  amount: number;
  currency: 'USD' | 'EUR';
}

/**
 * A price for one card, in one print variant, at one condition, at one instant.
 */
export interface PriceQuote {
  cardId: string;
  variant: PrintVariant;
  condition: Condition;
  price: Money;
  provenance: Provenance;
  source: PriceSource;
  /** ISO-8601. For `observed` this is the marketplace's own `updatedAt`. */
  asOf: string;
  /**
   * Present only when `provenance === 'modeled'`. Explains exactly how the
   * number was derived so the UI can show its work, plus the plausible range.
   */
  model?: {
    /** Human-readable derivation, e.g. "TCGplayer market (NM) x 0.70 (MP)". */
    basis: string;
    multiplier: number;
    /** Inclusive range the true value plausibly falls in. */
    low: number;
    high: number;
    /** How much to trust this, 0–1. Falls with card age and rarity. */
    confidence: number;
  };
}

/** One point on a price-history chart. */
export interface PricePoint {
  /** ISO-8601 date (day granularity). */
  date: string;
  price: Money;
  provenance: Provenance;
  source: PriceSource;
  /** For modeled points, the uncertainty band to shade. */
  band?: { low: number; high: number };
}

/** A named, renderable series of price points for one condition. */
export interface PriceSeries {
  cardId: string;
  variant: PrintVariant;
  condition: Condition;
  points: PricePoint[];
  /**
   * True when every point is real (never `modeled`). The chart legend and any
   * summary statistic derived from this series must respect this flag.
   */
  allReal: boolean;
}

/** The pricing panel for one card: current quotes plus history. */
export interface CardPricing {
  cardId: string;
  /** Current quotes across variants and conditions. */
  quotes: PriceQuote[];
  series: PriceSeries[];
  /** Best current estimate of NM market value, used for ranking in bulk scans. */
  headline: PriceQuote | null;
  /** Anything the user should know about the quality of this data. */
  caveats: string[];
  fetchedAt: string;
}

// ---------------------------------------------------------------------------
// Authenticity
// ---------------------------------------------------------------------------

/** The individual checks the authenticity engine can run. */
export type AuthSignalId =
  | 'geometry'
  | 'color'
  | 'print'
  | 'text'
  | 'holo'
  | 'vision';

/**
 * The outcome of one authenticity check.
 *
 * `status` matters as much as `score`. A check that could not run (bad lighting,
 * insufficient resolution, card type the check does not apply to) reports
 * `not_applicable` or `insufficient_data` and is EXCLUDED from the verdict —
 * it is never silently scored as a pass or a fail. Scoring an unrunnable check
 * is how naive authenticators generate false accusations.
 */
export interface AuthSignal {
  id: AuthSignalId;
  label: string;
  status: 'ok' | 'not_applicable' | 'insufficient_data' | 'error';
  /** 0–100, higher = more consistent with a genuine card. Null unless status is 'ok'. */
  score: number | null;
  /** How much this signal counts toward the verdict, 0–1. */
  weight: number;
  /** One-line plain-English result for the user. */
  summary: string;
  /** The actual measurements, so the report can show its work. */
  measurements: Record<string, number | string | boolean | null>;
  /** Why the check could not run, when status is not 'ok'. */
  reason?: string;
}

/**
 * The overall verdict.
 *
 * Deliberately NOT "REAL" / "FAKE". A photo cannot prove authenticity — the
 * decisive tests (card thickness, the blue core layer, light transmission,
 * material feel) require physical possession. The verdict vocabulary is chosen
 * so the app never claims more certainty than it has.
 */
export type AuthVerdict =
  | 'consistent_with_genuine'
  | 'inconclusive'
  | 'red_flags';

export interface AuthReport {
  cardId: string | null;
  verdict: AuthVerdict;
  /** 0–100 weighted score across signals that actually ran. */
  score: number;
  /** 0–1. How much the engine trusts its own verdict given what it could run. */
  confidence: number;
  signals: AuthSignal[];
  /** Specific things that looked wrong, in priority order. */
  concerns: string[];
  /**
   * What this analysis fundamentally could not determine. Always non-empty —
   * these are surfaced in the UI on every report, not hidden behind a link.
   */
  limitations: string[];
  analyzedAt: string;
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/** A candidate match from the identification pipeline. */
export interface IdentifyCandidate {
  card: Card;
  /** 0–1 confidence that this is the card in the photo. */
  confidence: number;
  /** Which techniques contributed, e.g. ["ocr:number", "vision:name"]. */
  evidence: string[];
}

export interface IdentifyResult {
  candidates: IdentifyCandidate[];
  /** Text the OCR/vision layer actually read, for debugging and manual correction. */
  extracted: {
    name: string | null;
    number: string | null;
    setTotal: string | null;
    setHint: string | null;
  };
  /** True when the top candidate is confident enough to auto-select. */
  autoSelected: boolean;
  method: 'ocr' | 'vision' | 'ocr+vision' | 'manual';
  warnings: string[];
}

/** One card processed in a scan (single or bulk). */
export interface ScanResult {
  /** Client-generated id so results can be tracked before the card is known. */
  scanId: string;
  capturedAt: string;
  identify: IdentifyResult;
  /** Chosen card — the top candidate, or the user's manual correction. */
  card: Card | null;
  pricing: CardPricing | null;
  auth: AuthReport | null;
  /** Data URL or stored path of the captured (perspective-corrected) image. */
  imageRef: string | null;
}

/** A bulk scan session: many cards, ranked by value. */
export interface BulkScanSession {
  sessionId: string;
  startedAt: string;
  results: ScanResult[];
  /** Cards at or above the user's "worth attention" threshold. */
  valuableThreshold: Money;
}
