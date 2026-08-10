/**
 * Client for the Pokemon TCG API v2 (https://api.pokemontcg.io/v2).
 *
 * Schema here was verified against live responses rather than taken from docs.
 * Notably: `tcgplayer.prices` is keyed by print variant (only the variants a card
 * was actually printed in appear), and `cardmarket.prices` carries real rolling
 * averages (avg1/avg7/avg30) which we use to seed genuine short-range history.
 */

import type { Card, CardSet, PrintVariant } from './types';
import { PRINT_VARIANTS } from './types';

const API_BASE = 'https://api.pokemontcg.io/v2';

/** Raw shapes, as actually returned by the API. */
export interface RawTcgPlayerPrices {
  low: number | null;
  mid: number | null;
  high: number | null;
  market: number | null;
  directLow: number | null;
}

export interface RawTcgPlayer {
  url: string;
  /** "YYYY/MM/DD" — note the slashes, this is not ISO. */
  updatedAt: string;
  prices: Partial<Record<PrintVariant, RawTcgPlayerPrices>>;
}

/**
 * Cardmarket prices, in EUR. `avg1`/`avg7`/`avg30` are rolling average sale
 * prices over the trailing 1/7/30 days — real observations, and the only free
 * historical signal available to us.
 */
export interface RawCardmarketPrices {
  averageSellPrice: number | null;
  lowPrice: number | null;
  trendPrice: number | null;
  germanProLow: number | null;
  suggestedPrice: number | null;
  reverseHoloSell: number | null;
  reverseHoloLow: number | null;
  reverseHoloTrend: number | null;
  /** Lowest price for a card in Excellent condition or better — a real condition signal. */
  lowPriceExPlus: number | null;
  avg1: number | null;
  avg7: number | null;
  avg30: number | null;
  reverseHoloAvg1: number | null;
  reverseHoloAvg7: number | null;
  reverseHoloAvg30: number | null;
}

export interface RawCardmarket {
  url: string;
  updatedAt: string;
  prices: RawCardmarketPrices;
}

export interface RawCard {
  id: string;
  name: string;
  number: string;
  supertype?: string;
  subtypes?: string[];
  rarity?: string;
  artist?: string;
  images: { small: string; large: string };
  set: {
    id: string;
    name: string;
    series: string;
    printedTotal: number;
    total: number;
    releaseDate: string;
    images: { symbol: string; logo: string };
  };
  tcgplayer?: RawTcgPlayer;
  cardmarket?: RawCardmarket;
}

export class TcgApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'TcgApiError';
  }
}

function headers(): HeadersInit {
  const h: Record<string, string> = { Accept: 'application/json' };
  const key = process.env.POKEMONTCG_API_KEY;
  // The key is optional; without it the API applies a much lower rate limit.
  if (key) h['X-Api-Key'] = key;
  return h;
}

/**
 * GET with bounded retry. 429 and 5xx are retryable (the API returns transient
 * 500s under load — observed in practice), 4xx otherwise is not.
 */
async function get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params ?? {})) {
    url.searchParams.set(k, String(v));
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 2 ** attempt * 250));
    }
    try {
      const res = await fetch(url, {
        headers: headers(),
        // Card and set data is effectively static; prices update daily.
        next: { revalidate: 60 * 60 * 6 },
      });

      if (res.ok) return (await res.json()) as T;

      const retryable = res.status === 429 || res.status >= 500;
      lastError = new TcgApiError(
        `Pokemon TCG API ${res.status} for ${url.pathname}${url.search}`,
        res.status,
        retryable,
      );
      if (!retryable) throw lastError;
    } catch (err) {
      if (err instanceof TcgApiError && !err.retryable) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError ?? new Error('Pokemon TCG API request failed');
}

// ---------------------------------------------------------------------------
// Query building
// ---------------------------------------------------------------------------

/**
 * Escape a value for the API's Lucene-ish `q` syntax. Card names routinely
 * contain characters that break an unquoted query — "Farfetch'd", "Mr. Mime",
 * "Ho-Oh", "Type: Null", "Flabébé". Quoting and escaping is not optional.
 */
export function quoteTerm(value: string): string {
  return `"${value.replace(/(["\\])/g, '\\$1')}"`;
}

export interface CardSearch {
  name?: string;
  setId?: string;
  number?: string;
  rarity?: string;
  /** Free-form clause appended verbatim, for callers that need the raw syntax. */
  raw?: string;
}

export function buildQuery(s: CardSearch): string {
  const parts: string[] = [];
  if (s.name) parts.push(`name:${quoteTerm(s.name)}`);
  if (s.setId) parts.push(`set.id:${quoteTerm(s.setId)}`);
  if (s.number) parts.push(`number:${quoteTerm(s.number)}`);
  if (s.rarity) parts.push(`rarity:${quoteTerm(s.rarity)}`);
  if (s.raw) parts.push(s.raw);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function toCardSet(raw: RawCard['set']): CardSet {
  return {
    id: raw.id,
    name: raw.name,
    series: raw.series,
    printedTotal: raw.printedTotal,
    total: raw.total,
    releaseDate: raw.releaseDate,
    images: raw.images,
  };
}

/** Which print variants this card actually has, per TCGplayer's price keys. */
export function variantsOf(raw: RawCard): PrintVariant[] {
  const keys = Object.keys(raw.tcgplayer?.prices ?? {});
  const known = keys.filter((k): k is PrintVariant =>
    (PRINT_VARIANTS as readonly string[]).includes(k),
  );
  if (known.length > 0) return known;
  // No price data (common for very new or very obscure cards). Infer a sensible
  // default from rarity rather than claiming zero variants.
  return /holo|rare|ex|gx|v|vmax/i.test(raw.rarity ?? '') ? ['holofoil'] : ['normal'];
}

export function toCard(raw: RawCard): Card {
  return {
    id: raw.id,
    name: raw.name,
    number: raw.number,
    set: toCardSet(raw.set),
    rarity: raw.rarity ?? null,
    supertype: raw.supertype ?? null,
    subtypes: raw.subtypes ?? [],
    artist: raw.artist ?? null,
    images: raw.images,
    variants: variantsOf(raw),
  };
}

/** Convert the API's "YYYY/MM/DD" timestamps into ISO dates. */
export function parseApiDate(value: string | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(value.trim());
  if (!m) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getRawCard(id: string): Promise<RawCard | null> {
  try {
    const res = await get<{ data: RawCard }>(`/cards/${encodeURIComponent(id)}`);
    return res.data ?? null;
  } catch (err) {
    if (err instanceof TcgApiError && err.status === 404) return null;
    throw err;
  }
}

export async function getCard(id: string): Promise<Card | null> {
  const raw = await getRawCard(id);
  return raw ? toCard(raw) : null;
}

export async function searchRawCards(
  search: CardSearch,
  opts: { page?: number; pageSize?: number; orderBy?: string } = {},
): Promise<{ cards: RawCard[]; totalCount: number }> {
  const q = buildQuery(search);
  if (!q) return { cards: [], totalCount: 0 };

  const res = await get<{ data: RawCard[]; totalCount: number }>('/cards', {
    q,
    page: opts.page ?? 1,
    pageSize: Math.min(opts.pageSize ?? 24, 250),
    ...(opts.orderBy ? { orderBy: opts.orderBy } : {}),
  });
  return { cards: res.data ?? [], totalCount: res.totalCount ?? 0 };
}

export async function searchCards(
  search: CardSearch,
  opts?: { page?: number; pageSize?: number; orderBy?: string },
): Promise<{ cards: Card[]; totalCount: number }> {
  const { cards, totalCount } = await searchRawCards(search, opts);
  return { cards: cards.map(toCard), totalCount };
}

/**
 * Fetch many cards by id concurrently, with a small pool so bulk scans do not
 * trip the rate limit. Missing ids are omitted rather than throwing.
 */
export async function getCardsByIds(ids: string[], concurrency = 4): Promise<Map<string, RawCard>> {
  const out = new Map<string, RawCard>();
  const queue = [...new Set(ids)];

  async function worker(): Promise<void> {
    for (;;) {
      const id = queue.shift();
      if (id === undefined) return;
      try {
        const card = await getRawCard(id);
        if (card) out.set(id, card);
      } catch {
        // A single failed lookup must not abort a bulk scan.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return out;
}
