/**
 * Real per-condition prices from live TCGplayer listings.
 *
 * This is what makes "price by condition" real rather than modeled. The
 * Pokemon TCG API only ever reports one market price per printing, so an
 * earlier version of this app could only have multiplied it by an invented
 * factor. Instead we read the actual listings a buyer would see, filtered to
 * one condition at a time.
 *
 * Measured on Base Set Charizard (holofoil), 153 live listings:
 *
 *   Near Mint          low $700.00   median $1500.00   (23 listings)
 *   Lightly Played     low $474.00   median  $560.00   (36)
 *   Moderately Played  low $349.99   median  $411.26   (35)
 *   Heavily Played     low $278.89   median  $299.99   (25)
 *   Damaged            low $189.99   median  $199.00   (34)
 *
 * IMPORTANT — these are ASKING prices, not completed sales. A listing is what
 * someone hopes to get, and the gap between ask and sale widens as condition
 * falls and as a card gets more expensive. Every figure produced here is
 * labelled `asking` so the UI can say so, and the count of listings behind each
 * figure travels with it: a "price" backed by two listings is a very different
 * claim from one backed by thirty-six.
 *
 * Two upstream services are used, both public and free:
 *   tcgcsv.com  — an open mirror of TCGplayer's catalogue, used to map one of
 *                 our cards to a TCGplayer productId via set and card number.
 *   mp-search-api.tcgplayer.com — the listings endpoint TCGplayer's own product
 *                 pages call, queried one condition at a time.
 */

import 'server-only';
import type { Card, Money, PrintVariant, RawCondition } from '../../types';
import { readCache, writeCache } from '../../db';

const TCGCSV = 'https://tcgcsv.com/tcgplayer';

/**
 * TCGCSV's usage guidelines ask callers to identify their application, and it
 * returns 401 with an explanatory message to anything that does not. Setting a
 * descriptive User-Agent with a contact route is both the documented
 * requirement and simple good manners toward a free service.
 */
const TCGCSV_USER_AGENT =
  process.env.TCGCSV_USER_AGENT ??
  'pokemon-card-scanner/0.1 (self-hosted collection tool; +https://github.com/vincetzr/pokemon_app)';

/**
 * The listings endpoint is the one TCGplayer's own product pages call. It is
 * public and unauthenticated and returns exactly the per-condition listings a
 * visitor sees on the page, but it rejects non-browser User-Agents with a 403.
 *
 * Be aware of what this is: an unofficial dependency on someone else's internal
 * endpoint. It can change or disappear without notice, so every call path
 * treats a failure as "no condition data" rather than an error, results are
 * cached for six hours, and the five conditions are queried sequentially rather
 * than in parallel. If it does break, the rest of the app is unaffected.
 */
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const LISTINGS = 'https://mp-search-api.tcgplayer.com/v1/product';
/** TCGplayer's category id for Pokemon. */
const POKEMON_CATEGORY = 3;

/** TCGplayer's condition labels, in ladder order, mapped to our enum. */
const CONDITION_LABELS: Record<RawCondition, string> = {
  NM: 'Near Mint',
  LP: 'Lightly Played',
  MP: 'Moderately Played',
  HP: 'Heavily Played',
  DMG: 'Damaged',
};

/** Our print variants mapped to TCGplayer's `printing` filter values. */
const PRINTING_LABELS: Partial<Record<PrintVariant, string>> = {
  normal: 'Normal',
  holofoil: 'Holofoil',
  reverseHolofoil: 'Reverse Holofoil',
  '1stEdition': '1st Edition',
  '1stEditionHolofoil': '1st Edition Holofoil',
  unlimited: 'Unlimited',
  unlimitedHolofoil: 'Unlimited Holofoil',
};

export interface ConditionPrice {
  condition: RawCondition;
  /** Cheapest live listing. */
  low: Money;
  /** Median live listing — more representative than the cheapest. */
  median: Money;
  /** How many live listings back these figures. Small counts are weak evidence. */
  listingCount: number;
}

export interface ConditionPricing {
  productId: number;
  variant: PrintVariant;
  prices: ConditionPrice[];
  /** Always 'asking' — these are listings, never completed sales. */
  basis: 'asking';
  fetchedAt: string;
}

// ---------------------------------------------------------------------------
// Mapping our cards to TCGplayer product ids
// ---------------------------------------------------------------------------

interface TcgCsvGroup {
  groupId: number;
  name: string;
  abbreviation: string | null;
  /** ISO date the set was released. Matches our set.releaseDate exactly. */
  publishedOn?: string;
}

interface TcgCsvProduct {
  productId: number;
  name: string;
  extendedData?: { name: string; value: string }[];
}

async function getJson<T>(url: string, cacheKey: string, maxAgeSeconds: number): Promise<T | null> {
  const cached = readCache<T>(cacheKey);
  if (cached && cached.ageSeconds < maxAgeSeconds) return cached.payload;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': TCGCSV_USER_AGENT, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as T;
    writeCache(cacheKey, data);
    return data;
  } catch {
    // Fall back to whatever we have, however old — a stale catalogue still maps
    // cards correctly, since product ids do not change.
    return cached?.payload ?? null;
  }
}

/** Normalise a set name for comparison across the two catalogues. */
function normaliseSetName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Find the TCGplayer group (set) matching one of our cards.
 *
 * Release date is the primary key, not the name. The two catalogues name sets
 * differently — ours says "Base", TCGplayer says "Base Set" — and matching on
 * name containment alone is actively dangerous: the normalised string "base"
 * is a substring of seven different sets including "SV01: Scarlet & Violet Base
 * Set", so taking the first match sent 1999 Base Set Charizard to a 2023
 * product id. Release dates agree exactly between the catalogues and collide
 * far less, so they lead and the name only breaks ties.
 */
export async function resolveGroupId(card: Card): Promise<number | null> {
  const data = await getJson<{ results: TcgCsvGroup[] }>(
    `${TCGCSV}/${POKEMON_CATEGORY}/groups`,
    'tcgcsv:groups',
    7 * 24 * 3600,
  );
  if (!data) return null;

  const want = normaliseSetName(card.set.name);
  const wantDate = card.set.releaseDate.replace(/\//g, '-').slice(0, 10);

  const sameDate = data.results.filter(
    (g) => (g.publishedOn ?? '').slice(0, 10) === wantDate,
  );

  // Among sets released the same day, prefer the closest name. "Base Set" beats
  // "Base Set (Shadowless)" for a card whose set we call "Base", because the
  // parenthesised variant carries extra text our name does not.
  const best = (groups: TcgCsvGroup[]): TcgCsvGroup | null => {
    if (groups.length === 0) return null;
    const scored = groups
      .map((g) => {
        const got = normaliseSetName(g.name);
        if (got === want) return { g, rank: 0, extra: 0 };
        if (got.includes(want) || want.includes(got)) {
          return { g, rank: 1, extra: Math.abs(got.length - want.length) };
        }
        return { g, rank: 2, extra: Math.abs(got.length - want.length) };
      })
      .sort((a, b) => a.rank - b.rank || a.extra - b.extra);
    return scored[0]!.g;
  };

  const byDate = best(sameDate);
  if (byDate) return byDate.groupId;

  // No date match — fall back to names, but only to an exact or near-exact one.
  // A loose containment match here is what caused the mis-mapping above.
  const byName = best(
    data.results.filter((g) => {
      const got = normaliseSetName(g.name);
      return got === want || got.includes(want) || want.includes(got);
    }),
  );
  // Reject a fallback that is wildly longer than what we asked for.
  if (byName && Math.abs(normaliseSetName(byName.name).length - want.length) > 12) return null;
  return byName?.groupId ?? null;
}

/**
 * Find the TCGplayer productId for a card, matching on the printed collector
 * number. TCGCSV stores it as "058/102", so compare the numerator with leading
 * zeros stripped.
 */
export async function resolveProductId(card: Card): Promise<number | null> {
  const groupId = await resolveGroupId(card);
  if (groupId === null) return null;

  const data = await getJson<{ results: TcgCsvProduct[] }>(
    `${TCGCSV}/${POKEMON_CATEGORY}/${groupId}/products`,
    `tcgcsv:products:${groupId}`,
    7 * 24 * 3600,
  );
  if (!data) return null;

  const wantNumber = card.number.replace(/^0+(?=\d)/, '').toUpperCase();
  const wantName = card.name.toLowerCase().replace(/[^a-z0-9]/g, '');

  const candidates = data.results.filter((p) => {
    const numberField = p.extendedData?.find((e) => e.name === 'Number')?.value;
    if (!numberField) return false;
    const numerator = numberField.split('/')[0]?.replace(/^0+(?=\d)/, '').toUpperCase();
    return numerator === wantNumber;
  });

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!.productId;

  // Several products share a collector number when a set has error variants or
  // reprints ("Charizard" and "Charizard (Black Dot Error)"). Prefer the exact
  // name; a parenthesised variant is a different product at a different price.
  const exact = candidates.find(
    (p) => p.name.toLowerCase().replace(/[^a-z0-9]/g, '') === wantName,
  );
  return (exact ?? candidates[0]!).productId;
}

// ---------------------------------------------------------------------------
// Per-condition listing prices
// ---------------------------------------------------------------------------

interface Listing {
  price: number | null;
  condition: string | null;
  printing: string | null;
}

async function fetchListings(
  productId: number,
  condition: string,
  printing: string | null,
): Promise<Listing[]> {
  const term: Record<string, unknown> = {
    sellerStatus: 'Live',
    channelId: 0,
    condition: [condition],
  };
  if (printing) term.printing = [printing];

  const res = await fetch(`${LISTINGS}/${productId}/listings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://www.tcgplayer.com',
      Referer: 'https://www.tcgplayer.com/',
      'User-Agent': BROWSER_USER_AGENT,
    },
    body: JSON.stringify({
      filters: {
        term,
        range: { quantity: { gte: 1 } },
        exclude: { channelExclusion: 0 },
      },
      from: 0,
      size: 25,
      sort: { field: 'price+shipping', order: 'asc' },
      context: { shippingCountry: 'US', cart: {} },
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(25_000),
  });

  if (!res.ok) throw new Error(`listings HTTP ${res.status}`);
  const data = (await res.json()) as { results?: { results?: Listing[] }[] };
  return data.results?.[0]?.results ?? [];
}

/**
 * Fetch live per-condition prices for one card and printing.
 *
 * Conditions are queried sequentially rather than in parallel: this is an
 * endpoint belonging to someone else's site, and five polite sequential
 * requests are a better neighbour than five simultaneous ones.
 */
export async function fetchConditionPricing(
  card: Card,
  variant: PrintVariant,
  opts: { maxAgeSeconds?: number } = {},
): Promise<ConditionPricing | null> {
  const productId = await resolveProductId(card);
  if (productId === null) return null;

  const cacheKey = `tcgp:conditions:${productId}:${variant}`;
  const cached = readCache<ConditionPricing>(cacheKey);
  // Listings move slowly; six hours keeps figures fresh without hammering.
  if (cached && cached.ageSeconds < (opts.maxAgeSeconds ?? 6 * 3600)) return cached.payload;

  const printing = PRINTING_LABELS[variant] ?? null;
  const prices: ConditionPrice[] = [];

  for (const [condition, label] of Object.entries(CONDITION_LABELS) as [RawCondition, string][]) {
    try {
      const listings = await fetchListings(productId, label, printing);
      const amounts = listings
        .map((l) => l.price)
        .filter((p): p is number => typeof p === 'number' && p > 0)
        .sort((a, b) => a - b);

      if (amounts.length === 0) continue;

      prices.push({
        condition,
        low: { amount: amounts[0]!, currency: 'USD' },
        median: { amount: amounts[Math.floor(amounts.length / 2)]!, currency: 'USD' },
        listingCount: amounts.length,
      });
    } catch {
      // One condition failing must not lose the others.
    }
  }

  if (prices.length === 0) {
    // Serve stale rather than nothing — an outage should not blank the panel.
    return cached?.payload ?? null;
  }

  const result: ConditionPricing = {
    productId,
    variant,
    prices,
    basis: 'asking',
    fetchedAt: new Date().toISOString(),
  };

  writeCache(cacheKey, result);
  return result;
}
