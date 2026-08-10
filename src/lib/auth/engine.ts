/**
 * The authenticity engine.
 *
 * The design problem here is not detecting fakes — it is avoiding false
 * accusations. Telling someone their genuine card is counterfeit is a much
 * worse failure than declining to reach a conclusion, because a wrong "fake"
 * verdict can cost a real sale, a trade, or a friendship, and the user has no
 * way to argue with it.
 *
 * Three rules follow from that, and they are enforced here rather than left to
 * each signal:
 *
 *  1. A signal that could not run properly ABSTAINS. It contributes nothing to
 *     the verdict and is not silently scored as a pass or a fail. Naive
 *     authenticators score every check regardless of whether the input
 *     supported it, which is precisely how they generate false accusations.
 *
 *  2. Confidence is separate from score. A card can score well on two signals,
 *     but if four abstained, the engine says so rather than projecting
 *     certainty it does not have.
 *
 *  3. The verdict vocabulary never says "fake". A photograph cannot establish
 *     authenticity: the decisive checks — card thickness, the opaque core
 *     layer, light transmission, material feel — all need the card in hand.
 *     The strongest negative statement available is "red flags", which is an
 *     instruction to look closer, not a conclusion.
 */

import type { AuthReport, AuthSignal, AuthVerdict } from '../types';

/**
 * Below this many effective signals, the engine refuses to reach a verdict at
 * all. Two signals agreeing is not evidence when four others could not run.
 */
const MIN_EFFECTIVE_SIGNALS = 2;

/** Score thresholds for the verdict bands. */
const THRESHOLDS = {
  /** At or above: consistent with a genuine card. */
  consistent: 70,
  /** Below this: concerns worth surfacing. Between the two: inconclusive. */
  concerning: 45,
} as const;

/** Limitations shown on EVERY report, regardless of outcome. */
export const UNIVERSAL_LIMITATIONS: readonly string[] = [
  'A photo cannot prove a card is genuine. The most reliable tests — card thickness, ' +
    'the opaque core layer visible when backlit, and how the card feels and bends — ' +
    'all require the card in hand.',
  'This tool compares your photo against the official card image and against what ' +
    'genuine cards typically measure. It cannot detect a counterfeit that reproduces ' +
    'those characteristics accurately.',
  'A result here is not an appraisal or a certificate. For anything valuable, use a ' +
    'professional grading service such as PSA, Beckett, or CGC.',
];

/** What a user should actually do next, by verdict. */
export const NEXT_STEPS: Record<AuthVerdict, readonly string[]> = {
  consistent_with_genuine: [
    'Hold the card up to a bright light. A genuine card is opaque because of a dark ' +
      'inner core layer; most fakes let noticeably more light through.',
    'Compare thickness and finish against a card you know is genuine from the same era.',
    'Bend it very gently. A genuine card springs back; many fakes stay creased or feel limp.',
  ],
  inconclusive: [
    'Retake the photo: fill the frame, keep the card flat and parallel to the camera, ' +
      'and avoid glare and shadows. Most inconclusive results are caused by the photo, ' +
      'not the card.',
    'Photograph the back as well — wrong blue tones and a misshapen Poke Ball are among ' +
      'the easiest counterfeit tells to see by eye.',
    'Compare side by side with a card you know is genuine from the same set.',
  ],
  red_flags: [
    'Do not treat this as proof of a counterfeit. Verify by hand before acting on it.',
    'Backlight the card and compare it against a known-genuine card from the same era.',
    'If the card is valuable or you are mid-transaction, get it professionally ' +
      'authenticated before money changes hands.',
    'If you bought it recently, check the seller\'s return window while you verify.',
  ],
};

export interface EngineInput {
  cardId: string | null;
  signals: AuthSignal[];
  /** Extra limitations specific to this analysis, e.g. era-specific gaps. */
  contextLimitations?: string[];
}

/**
 * Combine signals into a verdict.
 *
 * Score is the weighted mean over signals that actually ran. Confidence is the
 * share of total possible weight those signals represent, so heavy abstention
 * drives confidence down even when the surviving scores look good.
 */
export function buildReport(input: EngineInput): AuthReport {
  const { signals } = input;
  const ran = signals.filter((s) => s.status === 'ok' && s.score !== null);

  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const ranWeight = ran.reduce((sum, s) => sum + s.weight, 0);

  const score =
    ranWeight > 0
      ? ran.reduce((sum, s) => sum + (s.score as number) * s.weight, 0) / ranWeight
      : 0;

  // Coverage is how much of the intended analysis actually happened.
  const coverage = totalWeight > 0 ? ranWeight / totalWeight : 0;

  const concerns = collectConcerns(ran);
  const verdict = decideVerdict(ran.length, score, coverage);

  // Confidence is deliberately capped well below 1. Even with every signal
  // running, a photo-only analysis should never present itself as certain.
  const confidence = Math.min(0.85, coverage * (ran.length >= 4 ? 1 : 0.8));

  const limitations = [...UNIVERSAL_LIMITATIONS, ...(input.contextLimitations ?? [])];

  const abstained = signals.filter((s) => s.status !== 'ok');
  if (abstained.length > 0) {
    limitations.push(
      `${abstained.length} of ${signals.length} checks could not run on this photo ` +
        `(${abstained.map((s) => s.label).join(', ')}), so this analysis is partial.`,
    );
  }

  return {
    cardId: input.cardId,
    verdict,
    score: Math.round(score),
    confidence: Number(confidence.toFixed(2)),
    signals,
    concerns,
    limitations,
    analyzedAt: new Date().toISOString(),
  };
}

function decideVerdict(ranCount: number, score: number, coverage: number): AuthVerdict {
  // Too little actually ran to say anything at all.
  if (ranCount < MIN_EFFECTIVE_SIGNALS || coverage < 0.35) return 'inconclusive';

  if (score >= THRESHOLDS.consistent) return 'consistent_with_genuine';
  if (score < THRESHOLDS.concerning) return 'red_flags';
  return 'inconclusive';
}

/** Pull user-facing concerns from the signals that scored poorly. */
function collectConcerns(ran: AuthSignal[]): string[] {
  return ran
    .filter((s) => (s.score as number) < THRESHOLDS.concerning)
    .sort((a, b) => (a.score as number) - (b.score as number))
    .map((s) => s.summary);
}

// ---------------------------------------------------------------------------
// Signal helpers
// ---------------------------------------------------------------------------

/** Build an abstaining signal, so callers never have to invent a score. */
export function abstain(
  id: AuthSignal['id'],
  label: string,
  weight: number,
  status: 'not_applicable' | 'insufficient_data' | 'error',
  reason: string,
): AuthSignal {
  return {
    id,
    label,
    status,
    score: null,
    weight,
    summary: reason,
    measurements: {},
    reason,
  };
}

/**
 * Map a measured deviation onto a 0–100 score.
 *
 * Deliberately gentle near the acceptable end: genuine cards vary, photos vary
 * more, and a steep curve would turn ordinary variation into a low score.
 * `good` scores 100, `bad` scores 0, and the curve between them is linear.
 */
export function scoreFromDeviation(value: number, good: number, bad: number): number {
  if (bad === good) return value <= good ? 100 : 0;
  const t = (value - good) / (bad - good);
  return Math.round(Math.max(0, Math.min(1, 1 - t)) * 100);
}

/** Verdict presentation metadata, kept next to the logic that produces it. */
export const VERDICT_META: Record<
  AuthVerdict,
  { label: string; tone: 'good' | 'warn' | 'bad'; blurb: string }
> = {
  consistent_with_genuine: {
    label: 'Consistent with genuine',
    tone: 'good',
    blurb:
      'Nothing in this photo contradicts a genuine card. That is not the same as proof — ' +
      'confirm by hand before relying on it.',
  },
  inconclusive: {
    label: 'Inconclusive',
    tone: 'warn',
    blurb:
      'Not enough could be determined from this photo to say either way. This usually ' +
      'means the capture was limiting, not that the card is suspect.',
  },
  red_flags: {
    label: 'Red flags',
    tone: 'bad',
    blurb:
      'One or more checks came back inconsistent with a genuine card. Treat this as a ' +
      'prompt to inspect the card closely, not as a conclusion that it is fake.',
  },
};
