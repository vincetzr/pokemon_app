/**
 * Server-side card resolution: turning extracted text into ranked candidates.
 *
 * Split from `lookup.ts` so the scoring and parsing logic there stays free of
 * server-only imports and can run in the browser.
 *
 * Every upstream failure is reported rather than swallowed. Returning an empty
 * candidate list when the API was simply down would tell the user their card
 * does not exist, which is both wrong and unactionable.
 */

import 'server-only';
import type { IdentifyCandidate } from '../types';
import { toCard } from '../tcg-api';
import { searchCardsCached } from '../tcg-cache';
import { type ExtractedText, scoreCandidate } from './lookup';

export interface LookupOptions {
  maxCandidates?: number;
  /** Discard candidates scoring below this. */
  minConfidence?: number;
}

export interface LookupOutcome {
  candidates: IdentifyCandidate[];
  warnings: string[];
  /** True when at least one lookup fell back to stale cached data. */
  degraded: boolean;
}

/**
 * Find the cards that best match the extracted text.
 *
 * Queries run narrowest-first, because a narrow query is both more
 * discriminating and far more likely to succeed against this API:
 *   1. name + number  — nearly always unique
 *   2. name alone     — ranked locally by number and set total
 *   3. number alone   — when the name could not be read at all
 */
export async function findCandidates(
  extracted: ExtractedText,
  opts: LookupOptions = {},
): Promise<LookupOutcome> {
  const maxCandidates = opts.maxCandidates ?? 8;
  const minConfidence = opts.minConfidence ?? 0.25;

  const pool = new Map<string, ReturnType<typeof toCard>>();
  const warnings: string[] = [];
  let degraded = false;
  let attempted = 0;
  let failed = 0;

  const collect = async (search: Parameters<typeof searchCardsCached>[0], pageSize: number) => {
    attempted++;
    const result = await searchCardsCached(search, { pageSize });
    if (!result) {
      failed++;
      return;
    }
    if (result.degraded) degraded = true;
    for (const raw of result.data.cards) {
      const card = toCard(raw);
      pool.set(card.id, card);
    }
  };

  if (extracted.name && extracted.number) {
    await collect({ name: extracted.name, number: extracted.number }, 50);
  }
  if (pool.size === 0 && extracted.name) {
    await collect({ name: extracted.name }, 100);
  }
  if (pool.size === 0 && extracted.number) {
    await collect({ number: extracted.number }, 100);
  }

  if (failed > 0 && pool.size === 0) {
    warnings.push(
      'The card database could not be reached, so no matches could be looked up. ' +
        'This is usually temporary — try again in a moment.',
    );
    return { candidates: [], warnings, degraded };
  }

  if (failed > 0) {
    warnings.push(
      `${failed} of ${attempted} database queries failed, so this list may be incomplete.`,
    );
  }

  if (degraded) {
    warnings.push('Showing cached card data because the card database is currently unreachable.');
  }

  if (pool.size === 0) {
    warnings.push('No cards matched the text read from this photo.');
    return { candidates: [], warnings, degraded };
  }

  const scored = [...pool.values()]
    .map((card) => {
      const { score, evidence } = scoreCandidate(card, extracted);
      return { card, confidence: score, evidence };
    })
    .filter((c) => c.confidence >= minConfidence)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxCandidates);

  // When printings tie, prefer the earliest release: it is the more commonly
  // owned and more frequently asked-about version.
  scored.sort((a, b) =>
    Math.abs(a.confidence - b.confidence) < 0.02
      ? a.card.set.releaseDate.localeCompare(b.card.set.releaseDate)
      : b.confidence - a.confidence,
  );

  if (scored.length === 0) {
    warnings.push(
      'Cards were found but none matched closely enough to be confident. ' +
        'Try a sharper, straight-on photo, or search by name instead.',
    );
  }

  return { candidates: scored, warnings, degraded };
}
