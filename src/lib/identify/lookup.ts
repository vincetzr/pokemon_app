/**
 * Resolving extracted card text to an actual card.
 *
 * The hard part of identification is not reading the name — it is that a name
 * is nowhere near unique. "Pikachu" appears on hundreds of distinct cards. The
 * discriminator is the collector number together with the set total printed
 * beside it: "4/102" pins Base Set specifically, because 102 is the printed
 * total of exactly that set. That pairing does most of the work here, and the
 * name is used to confirm and to break remaining ties.
 */

import type { Card } from '../types';
import type { IdentifyCandidate } from '../types';

export interface ExtractedText {
  name: string | null;
  /** Collector number as printed, e.g. "4", "SV107", "TG12". */
  number: string | null;
  /** Denominator of the collector line, e.g. "102" in "4/102". */
  setTotal: string | null;
  /** Any other set hint, e.g. text read from the set logo. */
  setHint: string | null;
}

/**
 * Parse a collector line into its parts.
 *
 * Handles the formats actually printed on cards across eras:
 *   "4/102"        WOTC and most main-set cards
 *   "025/165"      zero-padded modern
 *   "SV107/SV122"  hidden-fates style shiny vault
 *   "TG12/TG30"    trainer gallery
 *   "199/165"      secret rare, numerator exceeds the denominator
 *   "SWSH284"      promo, no denominator at all
 */
export function parseCollectorLine(raw: string): { number: string | null; setTotal: string | null } {
  const text = raw.replace(/\s+/g, '').toUpperCase();

  const withTotal = /^([A-Z]{0,4}\d{1,4}[A-Z]?)\/([A-Z]{0,4}\d{1,4})$/.exec(text);
  if (withTotal) {
    return { number: normaliseNumber(withTotal[1]!), setTotal: stripLeadingZeros(withTotal[2]!) };
  }

  const promoOnly = /^([A-Z]{2,5}\d{1,4})$/.exec(text);
  if (promoOnly) return { number: normaliseNumber(promoOnly[1]!), setTotal: null };

  const plainOnly = /^(\d{1,4})$/.exec(text);
  if (plainOnly) return { number: stripLeadingZeros(plainOnly[1]!), setTotal: null };

  return { number: null, setTotal: null };
}

/**
 * The API stores numbers unpadded ("4", not "004") but keeps alphabetic
 * prefixes ("SV107", "TG12"), so normalise to match.
 */
function normaliseNumber(value: string): string {
  const prefixed = /^([A-Z]+)(\d+)([A-Z]?)$/.exec(value);
  if (prefixed) return `${prefixed[1]}${stripLeadingZeros(prefixed[2]!)}${prefixed[3] ?? ''}`;
  return stripLeadingZeros(value);
}

function stripLeadingZeros(value: string): string {
  const n = value.replace(/^0+(?=\d)/, '');
  return n.length > 0 ? n : value;
}

// ---------------------------------------------------------------------------
// Fuzzy name matching
// ---------------------------------------------------------------------------

/** Levenshtein distance, bounded so long strings stay cheap. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

/**
 * Normalise a card name for comparison. OCR reliably mangles the punctuation in
 * names like "Farfetch'd", "Mr. Mime", "Ho-Oh" and "Flabébé", so strip it all
 * and compare the letters.
 */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Similarity in 0–1, tolerant of the character errors OCR actually makes. */
export function nameSimilarity(a: string, b: string): number {
  const x = normaliseName(a);
  const y = normaliseName(b);
  if (x.length === 0 || y.length === 0) return 0;
  if (x === y) return 1;
  // A short OCR fragment that is a clean prefix of the real name is a strong
  // signal, not a weak one — cropped text is the usual cause.
  if (y.startsWith(x) || x.startsWith(y)) return 0.9;

  const distance = editDistance(x, y);
  return Math.max(0, 1 - distance / Math.max(x.length, y.length));
}

// ---------------------------------------------------------------------------
// Candidate resolution
// ---------------------------------------------------------------------------

/** Weights for the evidence types, tuned so no single weak signal can dominate. */
const WEIGHTS = {
  name: 0.42,
  number: 0.33,
  setTotal: 0.20,
  setHint: 0.05,
} as const;

export function scoreCandidate(card: Card, extracted: ExtractedText): { score: number; evidence: string[] } {
  const evidence: string[] = [];
  let score = 0;
  let available = 0;

  if (extracted.name) {
    available += WEIGHTS.name;
    const sim = nameSimilarity(extracted.name, card.name);
    score += sim * WEIGHTS.name;
    if (sim > 0.85) evidence.push(`name matches "${card.name}"`);
    else if (sim > 0.6) evidence.push(`name is close to "${card.name}"`);
  }

  if (extracted.number) {
    available += WEIGHTS.number;
    const want = normaliseNumber(extracted.number.toUpperCase());
    const got = normaliseNumber(card.number.toUpperCase());
    if (want === got) {
      score += WEIGHTS.number;
      evidence.push(`collector number ${card.number}`);
    }
  }

  if (extracted.setTotal) {
    available += WEIGHTS.setTotal;
    const want = Number(extracted.setTotal);
    // Match against printedTotal — the number actually on the card. `total`
    // includes secret rares and is usually higher, so it is not what was read.
    if (Number.isFinite(want) && want === card.set.printedTotal) {
      score += WEIGHTS.setTotal;
      evidence.push(`set size /${card.set.printedTotal} matches ${card.set.name}`);
    }
  }

  if (extracted.setHint) {
    available += WEIGHTS.setHint;
    const sim = nameSimilarity(extracted.setHint, card.set.name);
    score += sim * WEIGHTS.setHint;
    if (sim > 0.7) evidence.push(`set name resembles ${card.set.name}`);
  }

  const base = available > 0 ? score / available : 0;

  // A name mismatch is strong disconfirming evidence, whereas a number match is
  // weak confirming evidence — collector numbers repeat across thousands of
  // cards, so "number 4" matches Charizard and Weedle alike. Treating the two
  // additively lets a coincidental number carry a card whose name is plainly
  // different. The name therefore acts as a gate on the final score rather than
  // as just another term.
  return { score: base * nameGate(extracted.name, card.name), evidence };
}

/**
 * Multiplier applied when a name was read but does not match: 1.0 above 0.75
 * similarity, falling off to 0.2 at 0.4 and below. Returns 1 when no name was
 * legible, so an unreadable name never penalises a candidate.
 */
function nameGate(extractedName: string | null, cardName: string): number {
  if (!extractedName) return 1;

  const sim = nameSimilarity(extractedName, cardName);
  if (sim >= 0.75) return 1;
  if (sim <= 0.4) return 0.2;
  return 0.2 + ((sim - 0.4) / 0.35) * 0.8;
}

/** Whether the top candidate is clearly ahead enough to select without asking. */
export function shouldAutoSelect(candidates: IdentifyCandidate[], threshold = 0.8): boolean {
  const [first, second] = candidates;
  if (!first || first.confidence < threshold) return false;
  // A high score is not enough — it must also be clearly better than the
  // runner-up, or we are guessing between near-identical printings.
  return !second || first.confidence - second.confidence > 0.12;
}
