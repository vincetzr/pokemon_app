/**
 * GET /api/cards/[id] — one card with its full pricing picture.
 */

import { NextResponse } from 'next/server';
import { getCardCached } from '@/lib/tcg-cache';
import { toCard } from '@/lib/tcg-api';
import { buildPricing } from '@/lib/pricing/engine';
import { historyStats } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const cached = await getCardCached(id);
  if (!cached) {
    return NextResponse.json({ error: 'Card not found' }, { status: 404 });
  }

  const card = toCard(cached.data);
  const pricing = buildPricing(cached.data);

  if (cached.degraded) {
    pricing.caveats.unshift(
      `Prices are from cached data (${Math.round(cached.ageSeconds / 3600)}h old) because ` +
        'the card database is currently unreachable.',
    );
  }

  return NextResponse.json({
    card,
    pricing,
    history: historyStats(id),
    stale: cached.degraded,
  });
}
