/**
 * Collection management.
 *
 * POST adds a card, DELETE removes one. Saving a card matters beyond
 * bookkeeping: the collection page prices every saved card each time it loads,
 * and each of those lookups writes a price snapshot — so a collection someone
 * actually browses accrues genuine price history for the cards they care about.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { addToCollection, removeFromCollection } from '@/lib/db';
import { PRINT_VARIANTS, RAW_CONDITIONS } from '@/lib/types';
import type { Condition, PrintVariant } from '@/lib/types';

export const runtime = 'nodejs';

const AddBody = z.object({
  cardId: z.string().min(1),
  variant: z.enum(PRINT_VARIANTS as unknown as [PrintVariant, ...PrintVariant[]]).optional(),
  condition: z.enum(RAW_CONDITIONS as unknown as [string, ...string[]]).optional(),
  quantity: z.number().int().positive().max(999).optional(),
  notes: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  let body: z.infer<typeof AddBody>;
  try {
    body = AddBody.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof z.ZodError ? err.issues[0]?.message : 'Malformed request' },
      { status: 400 },
    );
  }

  const condition: Condition = {
    kind: 'raw',
    condition: (body.condition ?? 'NM') as (typeof RAW_CONDITIONS)[number],
  };

  addToCollection({
    cardId: body.cardId,
    variant: body.variant ?? 'normal',
    condition,
    quantity: body.quantity ?? 1,
    notes: body.notes,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get('id'));

  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'A valid entry id is required' }, { status: 400 });
  }

  removeFromCollection(id);
  return NextResponse.json({ ok: true });
}
