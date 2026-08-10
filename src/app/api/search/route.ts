/**
 * GET /api/search?q=... — manual card search.
 *
 * The fallback whenever identification is unsure or wrong. Because it is the
 * escape hatch, it reports upstream problems plainly instead of returning an
 * empty list that reads as "no such card".
 */

import { NextResponse } from 'next/server';
import { searchCardsCached } from '@/lib/tcg-cache';
import { toCard } from '@/lib/tcg-api';
import { parseCollectorLine } from '@/lib/identify/lookup';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get('q') ?? '').trim();

  if (query.length < 2) {
    return NextResponse.json({ cards: [], warnings: [] });
  }

  // Accept "Charizard 4/102" as well as a bare name — people naturally type the
  // collector number alongside the name when they have the card in hand.
  const collectorMatch = /([A-Za-z]{0,4}\d{1,4}\s*\/\s*[A-Za-z]{0,4}\d{1,4})\s*$/.exec(query);
  const name = collectorMatch ? query.slice(0, collectorMatch.index).trim() : query;
  const collector = collectorMatch ? parseCollectorLine(collectorMatch[1]!) : null;

  const result = await searchCardsCached(
    { name, ...(collector?.number ? { number: collector.number } : {}) },
    { pageSize: 40 },
  );

  if (!result) {
    return NextResponse.json({
      cards: [],
      warnings: ['The card database could not be reached. This is usually temporary.'],
    });
  }

  let cards = result.data.cards.map(toCard);

  // Rank exact name matches first, then by release date.
  const wanted = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  cards = cards.sort((a, b) => {
    const score = (n: string) => {
      const norm = n.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (norm === wanted) return 2;
      if (norm.startsWith(wanted)) return 1;
      return 0;
    };
    const diff = score(b.name) - score(a.name);
    return diff !== 0 ? diff : a.set.releaseDate.localeCompare(b.set.releaseDate);
  });

  const warnings: string[] = [];
  if (result.degraded) {
    warnings.push(
      `Showing cached results from ${Math.round(result.ageSeconds / 3600)}h ago — the card ` +
        'database is currently unreachable.',
    );
  }

  return NextResponse.json({ cards, totalCount: result.data.totalCount, warnings });
}
