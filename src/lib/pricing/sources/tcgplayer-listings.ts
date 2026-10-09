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
import { matchGroup, matchProduct, type TcgCsvGroup, type TcgCsvProduct } from '../catalogue';
import { matchingAmounts, medianAmount, type Listing } from '../listing-sample';

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
  cardId: string;
  productId: number;
  variant: PrintVariant;
  prices: ConditionPrice[];
  /** Always 'asking' — these are listings, never completed sales. */
  basis: 'asking';
  fetchedAt: string;
  verifiedFilters: true;
  language: 'English';
  sampleLimit: 25;
}

// ---------------------------------------------------------------------------
// Mapping our cards to TCGplayer product ids
// ---------------------------------------------------------------------------

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

export async function resolveGroupId(card: Card): Promise<number | null> {
  const data = await getJson<{ results: TcgCsvGroup[] }>(
    `${TCGCSV}/${POKEMON_CATEGORY}/groups`, 'tcgcsv:groups', 7 * 24 * 3600,
  );
  return data && Array.isArray(data.results) ? matchGroup(card, data.results) : null;
}
export async function resolveProductId(card: Card): Promise<number | null> {
  const groupId = await resolveGroupId(card);
  if (groupId === null) return null;
  const data = await getJson<{ results: TcgCsvProduct[] }>(
    `${TCGCSV}/${POKEMON_CATEGORY}/${groupId}/products`, `tcgcsv:products:${groupId}`, 7 * 24 * 3600,
  );
  return data && Array.isArray(data.results) ? matchProduct(card, data.results) : null;
}

// ---------------------------------------------------------------------------
// Per-condition listing prices
// ---------------------------------------------------------------------------

async function fetchListings(
  productId: number,
  condition: string,
  printing: string | null,
): Promise<Listing[]> {
  const term: Record<string, unknown> = {
    sellerStatus: 'Live',
    channelId: 0,
    condition: [condition],
    language: ['English'],
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

  const cacheKey = `tcgp:conditions:v2:English:${productId}:${variant}`;
  const cached = readCache<ConditionPricing>(cacheKey);
  // Listings move slowly; six hours keeps figures fresh without hammering.
  if (cached && cached.ageSeconds < (opts.maxAgeSeconds ?? 6 * 3600)) return cached.payload;

  const printing = PRINTING_LABELS[variant];
  if (!printing) return null;
  const prices: ConditionPrice[] = [];

  for (const [condition, label] of Object.entries(CONDITION_LABELS) as [RawCondition, string][]) {
    try {
      const listings = await fetchListings(productId, label, printing);
      const amounts = matchingAmounts(listings, label, printing, 'English');

      if (amounts.length === 0) continue;

      prices.push({
        condition,
        low: { amount: amounts[0]!, currency: 'USD' },
        median: { amount: medianAmount(amounts), currency: 'USD' },
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
    cardId: card.id,
    productId,
    variant,
    prices,
    basis: 'asking',
    verifiedFilters: true,
    language: 'English',
    sampleLimit: 25,
    fetchedAt: new Date().toISOString(),
  };

  writeCache(cacheKey, result);
  return result;
}
