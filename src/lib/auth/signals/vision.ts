/**
 * Vision authenticity signal.
 *
 * This is the one signal that can notice things no geometric measurement will:
 * text that is subtly the wrong weight, a holo pattern in the wrong region, a
 * set symbol that is the wrong shape, a copyright line that does not match the
 * era. It is also the signal most able to be confidently wrong, so it is
 * constrained hard:
 *
 *   - It reports OBSERVATIONS, not a verdict. The engine combines signals; this
 *     one does not get to decide.
 *   - It is told, explicitly, that legitimate cards vary enormously — miscuts,
 *     print lines, non-English printings, error cards, wear — and that flagging
 *     one of those as counterfeit is a worse failure than missing a fake.
 *   - It abstains when the image is poor rather than guessing, and abstains
 *     entirely when there is no API key.
 *
 * The era-specific reference data and tell catalogue are supplied as data
 * (`references`), so the prompt stays stable while the knowledge it reasons over
 * can be revised without touching this file.
 */

import 'server-only';
import type { AuthSignal, Card } from '../../types';
import { abstain } from '../engine';
import { IMAGE_SIZE, encodeImage, visionAvailable, visionJson } from '../../vision/client';
import { LEGITIMATE_VARIATION, eraForReleaseDate } from '../reference';

const ID = 'vision' as const;
const LABEL = 'Visual inspection';
const WEIGHT = 1.6;

const SCHEMA = {
  type: 'object',
  properties: {
    imageUsable: {
      type: 'boolean',
      description:
        'False if glare, blur, crop, or angle prevent a meaningful inspection. When false, ' +
        'every other field is ignored.',
    },
    unusableReason: { type: 'string' },
    observations: {
      type: 'array',
      description: 'Neutral descriptions of what is visible. Not judgements.',
      items: { type: 'string' },
      maxItems: 8,
    },
    concerns: {
      type: 'array',
      description:
        'Specific things inconsistent with a genuine card of this era. Empty if none. ' +
        'Do NOT list legitimate variation such as wear, centring, or a non-English printing.',
      items: {
        type: 'object',
        properties: {
          what: { type: 'string', description: 'What looks wrong, specifically.' },
          whereOnCard: { type: 'string' },
          severity: { type: 'string', enum: ['minor', 'moderate', 'serious'] },
          couldBeLegitimate: {
            type: 'string',
            description:
              'The most plausible innocent explanation — print variation, wear, photography. ' +
              'Always fill this in; every concern has one.',
          },
        },
        required: ['what', 'whereOnCard', 'severity', 'couldBeLegitimate'],
        additionalProperties: false,
      },
      maxItems: 6,
    },
    consistencyScore: {
      type: 'number',
      description:
        '0-100. How consistent this card looks with a genuine card of its era. 100 means ' +
        'nothing looks off. Use the middle of the range when unsure rather than the extremes.',
    },
    notes: { type: 'string', description: 'Anything limiting this assessment.' },
  },
  required: ['imageUsable', 'unusableReason', 'observations', 'concerns', 'consistencyScore', 'notes'],
  additionalProperties: false,
} as const;

interface VisionAssessment {
  imageUsable: boolean;
  unusableReason: string;
  observations: string[];
  concerns: {
    what: string;
    whereOnCard: string;
    severity: 'minor' | 'moderate' | 'serious';
    couldBeLegitimate: string;
  }[];
  consistencyScore: number;
  notes: string;
}

const SYSTEM = `You inspect photographs of Pokemon Trading Card Game cards and report what you
observe. You are one input among several in a tool that helps people avoid being
sold counterfeits.

You do not deliver a verdict. Report observations and specific concerns; the
system combines your report with physical measurements to reach a conclusion.

CALIBRATION — this matters more than sensitivity:

Wrongly flagging a genuine card is a worse outcome than missing a counterfeit.
A false accusation can cost someone a real sale or a trade, and they have no way
to argue with it. Missing a fake leaves them where they started.

Genuine cards vary enormously, and none of the following is evidence of a
counterfeit:
${LEGITIMATE_VARIATION.map((v) => `  - ${v}`).join('\n')}

If the photo is too poor to inspect properly, set imageUsable to false. That is
a useful answer. Guessing from a bad photo is not.

Every concern you raise must include the most plausible innocent explanation.
If you cannot think of one, you are probably over-reading the image.

TESTS THAT ARE WRONG — do not apply any of these, they accuse genuine cards:
  - "The collector number is higher than the set total." Secret rares, hyper
    rares and gold cards are numbered above the total by design.
  - "There is no set symbol." English Base Set genuinely has none; its absence
    identifies the set. Promos and Basic Energy also lack them.
  - "HP is not printed in red." Red HP was 1999-2003 only. From 2007 the format
    is an "HP 60" prefix in black.
  - "The card has no drop shadow." Base Set 1st Edition and Shadowless have none.
  - "The whole card is holo." Reverse holos, Cracked Ice, SV Mirage, full arts,
    VMAX, VSTAR, ex, gold and rainbow cards are all legitimately edge-to-edge.
  - "The colours are brighter than expected." Shadowless cards genuinely read
    brighter than Unlimited.
  - "It says NOT TOURNAMENT LEGAL." World Championship cards say that in
    manufacturer-printed text.
  - "The rarity symbol is not bottom-right." It moved to bottom-LEFT in 2017.
  - Any judgement of physical size, thickness or weight. You cannot measure
    those from a photograph.`;

export interface VisionSignalInput {
  /** The rectified card, encoded for upload. */
  image: Buffer;
  /** The card we believe this is; era and layout expectations come from it. */
  card: Card | null;
  /** Quality gate — a photo already known to be poor should not be sent. */
  imageUsable: boolean;
}

export async function visionSignal(input: VisionSignalInput): Promise<AuthSignal> {
  if (!visionAvailable()) {
    return abstain(
      ID,
      LABEL,
      WEIGHT,
      'not_applicable',
      'Visual inspection needs an Anthropic API key, which is not configured.',
    );
  }

  if (!input.imageUsable) {
    return abstain(
      ID,
      LABEL,
      WEIGHT,
      'insufficient_data',
      'The photo is too soft or too washed out for a visual inspection to be meaningful.',
    );
  }

  const era = input.card ? eraForReleaseDate(input.card.set.releaseDate) : null;

  // Era expectations are supplied explicitly. Layout, fonts, symbol positions
  // and holo patterns all changed substantially across 25 years, and judging a
  // card against the wrong era's expectations is the single largest source of
  // false concerns.
  const eraBlock = era
    ? `\nGENUINE CHARACTERISTICS FOR THIS ERA (${era.label}, ${era.from}-${era.to ?? 'present'}):
  - Border: ${era.borderNote} Width about ${era.borderWidthMm[0]}-${era.borderWidthMm[1]}mm.
  - HP is printed as ${era.hpFormat === 'prefix' ? 'a prefix, "HP 60"' : 'a suffix, "60 HP"'}, in ${era.hpColour}.
  - Set symbol position: ${era.setSymbolPosition.replace(/-/g, ' ')}.
  - Rarity symbol position: ${era.rarityPosition.replace(/-/g, ' ')}.
  - Standard holo pattern: ${era.holoPattern}.
  - Textured special rares: ${era.textured ? 'exist in this era' : 'do NOT exist in this era — a smooth full art is correct'}.
Judge the card against THESE expectations, not against a different era's.`
    : '';

  const context = input.card
    ? `This should be ${input.card.name} from ${input.card.set.name} (${input.card.number}/${input.card.set.printedTotal}), ` +
      `released ${input.card.set.releaseDate}${input.card.rarity ? `, rarity ${input.card.rarity}` : ''}.${eraBlock}`
    : `The specific card could not be identified, so its era is unknown. Assess only against ` +
      `general characteristics of genuine Pokemon cards, and be markedly more cautious about ` +
      `raising concerns — without knowing the era you cannot judge layout, fonts or symbols.`;

  const result = await visionJson<VisionAssessment>({
    image: await encodeImage(input.image, IMAGE_SIZE.authenticity),
    system: SYSTEM,
    prompt: `${context}

Inspect the card and report:
  - what you observe (neutral descriptions)
  - any specific concerns, each with its most plausible innocent explanation
  - a consistency score from 0 to 100

Look at print and text quality, font weight and spacing, colour rendering, the
set symbol and rarity mark, the collector line and copyright text, the holo
pattern and the region it covers, border geometry, and the card's overall
finish.`,
    schema: SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 3000,
  });

  if (!result) {
    return abstain(ID, LABEL, WEIGHT, 'error', 'Visual inspection could not be completed.');
  }

  if (!result.imageUsable) {
    return abstain(
      ID,
      LABEL,
      WEIGHT,
      'insufficient_data',
      result.unusableReason || 'The photo was not clear enough for a visual inspection.',
    );
  }

  const serious = result.concerns.filter((c) => c.severity === 'serious');
  const moderate = result.concerns.filter((c) => c.severity === 'moderate');

  const score = Math.round(Math.max(0, Math.min(100, result.consistencyScore)));

  const summary =
    serious.length > 0
      ? `${serious[0]!.what} (${serious[0]!.whereOnCard}). Could also be: ${serious[0]!.couldBeLegitimate}`
      : moderate.length > 0
        ? `${moderate[0]!.what} (${moderate[0]!.whereOnCard}). Could also be: ${moderate[0]!.couldBeLegitimate}`
        : result.concerns.length > 0
          ? `Minor observations only: ${result.concerns[0]!.what}.`
          : 'Nothing visually inconsistent with a genuine card of this era.';

  return {
    id: ID,
    label: LABEL,
    status: 'ok',
    score,
    weight: WEIGHT,
    summary,
    measurements: {
      concerns: result.concerns.length,
      serious: serious.length,
      moderate: moderate.length,
      observations: result.observations.length,
      ...(result.notes ? { notes: result.notes } : {}),
    },
  };
}
