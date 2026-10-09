import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCardCached } from '@/lib/tcg-cache';
import { toCard } from '@/lib/tcg-api';
import { PRINT_VARIANTS, RAW_CONDITIONS } from '@/lib/types';
import { fetchConditionPricing } from '@/lib/pricing/sources/tcgplayer-listings';
import { fetchGradedAskingSample } from '@/lib/pricing/graded';
import { COMPANIES, validGrade } from '@/lib/grading/rules';
import { usableRawSample, type RawAskingSample } from '@/lib/grading/condition-price';

export const runtime = 'nodejs';
export const maxDuration = 60;
const Body = z.object({ cardId: z.string().max(80), variant: z.enum(PRINT_VARIANTS),
  condition: z.discriminatedUnion('kind', [z.object({ kind: z.literal('raw'), condition: z.enum(RAW_CONDITIONS) }), z.object({ kind: z.literal('graded'), company: z.enum(COMPANIES), grade: z.number(), designation: z.string().max(40).nullish() })]) });
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Choose the card, printing and reviewed condition.' }, { status: 400 });
  const { cardId, variant, condition } = parsed.data;
  const cached = await getCardCached(cardId);
  if (!cached) return NextResponse.json({ error: 'Card not found.' }, { status: 404 });
  const card = toCard(cached.data);
  if (!card.variants.includes(variant)) return NextResponse.json({ error: 'This printing is not in the card catalogue.' }, { status: 400 });
  if (condition.kind === 'graded') {
    if (!validGrade(condition.company, condition.grade)) return NextResponse.json({ error: 'This grader does not use that grade.' }, { status: 400 });
    const graded = { company: condition.company, grade: condition.grade, designation: condition.designation };
    const sample = await fetchGradedAskingSample(card, variant, graded);
    return NextResponse.json({ sample, reason: sample ? null : 'No exact graded asking-price sample is available. Use the sold-comparables link; the raw market price does not value a slab.' });
  }
  const conditions = await fetchConditionPricing(card, variant, { conditions: [condition.condition] });
  const row = conditions?.prices.find(p => p.condition === condition.condition);
  const sample: RawAskingSample | null = row && conditions?.verifiedFilters ? { cardId, variant, condition: condition.condition,
    language: 'English', verifiedFilters: true, basis: 'asking', low: row.low.amount, median: row.median.amount, count: row.listingCount,
    asOf: conditions.fetchedAt, sourceUrl: 'https://www.tcgplayer.com/product/' + conditions.productId } : null;
  const current = usableRawSample(sample, cardId, variant, condition.condition);
  return NextResponse.json({ sample: current, reason: current ? null : 'No fresh verified listing sample is available for this printing and condition.' });
}
