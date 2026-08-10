/**
 * Cached, outage-tolerant access to the Pokemon TCG API. Server-only.
 *
 * Measured behaviour of the upstream API: repeating one identical query returns
 * 500/502 roughly half the time, and this holds for narrow queries too. An app
 * that calls it directly on every scan would fail constantly, so every
 * successful response is persisted and reused.
 *
 * The fallback ladder, in order:
 *   1. a fresh cache entry
 *   2. a live fetch (itself internally retried)
 *   3. a STALE cache entry, flagged as stale to the caller
 *   4. failure, reported explicitly rather than as an empty result
 *
 * Step 3 is the important one. Card data barely changes; serving a week-old
 * record during an outage is far better than telling the user their card does
 * not exist. Prices are the only part that ages, and staleness is surfaced so
 * the UI can say when the figures were last refreshed.
 */

import 'server-only';
import {
  type CardSearch,
  type RawCard,
  buildQuery,
  getRawCard,
  searchRawCards,
} from './tcg-api';
import { readCache, writeCache } from './db';

/** Card and set data is static; the embedded prices refresh daily upstream. */
const FRESH_SECONDS = 6 * 60 * 60;

export interface CachedResult<T> {
  data: T;
  /** How the result was obtained, so the UI can be honest about freshness. */
  origin: 'fresh-cache' | 'live' | 'stale-cache';
  /** Age of the underlying data in seconds; 0 for a live fetch. */
  ageSeconds: number;
  /** Set when we fell back to stale data because the API was unreachable. */
  degraded: boolean;
}

async function withCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  isEmpty: (value: T) => boolean,
): Promise<CachedResult<T> | null> {
  const cached = readCache<T>(key);

  if (cached && cached.ageSeconds < FRESH_SECONDS) {
    return { data: cached.payload, origin: 'fresh-cache', ageSeconds: cached.ageSeconds, degraded: false };
  }

  try {
    const data = await fetcher();
    // Do not cache an empty result: a transient upstream hiccup that returns no
    // rows would otherwise be remembered as "this card does not exist".
    if (!isEmpty(data)) writeCache(key, data);
    return { data, origin: 'live', ageSeconds: 0, degraded: false };
  } catch (err) {
    if (cached) {
      console.warn(
        `[tcg] live fetch failed for ${key}, serving cache from ${cached.fetchedAt}: ` +
          `${err instanceof Error ? err.message : err}`,
      );
      return { data: cached.payload, origin: 'stale-cache', ageSeconds: cached.ageSeconds, degraded: true };
    }
    return null;
  }
}

/** Fetch one card by id, falling back to cache during an outage. */
export async function getCardCached(id: string): Promise<CachedResult<RawCard> | null> {
  const result = await withCache<RawCard | null>(
    `card:${id}`,
    () => getRawCard(id),
    (v) => v === null,
  );
  if (!result || result.data === null) return null;
  return { ...result, data: result.data };
}

export interface CachedSearch {
  cards: RawCard[];
  totalCount: number;
}

/** Search cards, falling back to cache during an outage. */
export async function searchCardsCached(
  search: CardSearch,
  opts: { page?: number; pageSize?: number } = {},
): Promise<CachedResult<CachedSearch> | null> {
  const q = buildQuery(search);
  if (!q) return null;

  const key = `search:${q}|p${opts.page ?? 1}|n${opts.pageSize ?? 24}`;
  return withCache<CachedSearch>(
    key,
    () => searchRawCards(search, opts),
    (v) => v.cards.length === 0,
  );
}

/**
 * Fetch several cards concurrently with a small pool. Returns what it could get
 * plus the ids that failed, so a bulk scan can report partial results honestly
 * instead of silently dropping cards.
 */
export async function getCardsCached(
  ids: string[],
  concurrency = 3,
): Promise<{ cards: Map<string, RawCard>; failed: string[]; degraded: boolean }> {
  const cards = new Map<string, RawCard>();
  const failed: string[] = [];
  let degraded = false;
  const queue = [...new Set(ids)];

  async function worker(): Promise<void> {
    for (;;) {
      const id = queue.shift();
      if (id === undefined) return;
      const result = await getCardCached(id);
      if (result) {
        cards.set(id, result.data);
        if (result.degraded) degraded = true;
      } else {
        failed.push(id);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return { cards, failed, degraded };
}
