/**
 * Bake a corpus straight from the TCGplayer catalogue.
 *
 * The other bake script goes through the Pokemon TCG API, which is
 * English-only and carries no Shadowless printing. TCGCSV mirrors TCGplayer's
 * own catalogue, which has both: "Pokemon Japan" is category 85, and Base Set
 * (Shadowless) is its own group with its own product ids and therefore its own
 * prices. Every product also carries an image URL, so the perceptual
 * descriptors can be built from the same source as the prices rather than
 * matched across two catalogues.
 *
 *   npx tsx --conditions=react-server scripts/bake-tcgcsv.ts 3:1663 85:23599
 */

import sharp, { type Sharp } from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { REGIONS } from '../src/lib/card-geometry';
import { readCache, writeCache } from '../src/lib/db';

const OUT = process.env.BAKE_OUT ?? '/tmp/bake/tcgcsv.json';
const TCGCSV = 'https://tcgcsv.com/tcgplayer';
const LISTINGS = 'https://mp-search-api.tcgplayer.com/v1/product';

const TCGCSV_USER_AGENT =
  process.env.TCGCSV_USER_AGENT ??
  'pokemon-card-scanner/0.1 (self-hosted collection tool; +https://github.com/vincetzr/pokemon_app)';
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const THUMB_WIDTH = 104;
const HASH_GRID = 8;
const SIG_COLS = 4;
const SIG_ROWS = 6;

const CONDITION_LABELS = {
  NM: 'Near Mint',
  LP: 'Lightly Played',
  MP: 'Moderately Played',
  HP: 'Heavily Played',
  DMG: 'Damaged',
} as const;

interface TcgProduct {
  productId: number;
  name: string;
  cleanName?: string;
  imageUrl?: string;
  extendedData?: { name: string; value: string }[];
}

interface TcgGroup {
  groupId: number;
  name: string;
  publishedOn?: string;
}

interface BakedCard {
  id: string;
  name: string;
  number: string;
  printedTotal: number;
  setName: string;
  setId: string;
  releaseDate: string;
  rarity: string | null;
  artist: string | null;
  /** Market language, so the UI never quotes one region's price for another. */
  language: 'English' | 'Japanese';
  variants: string[];
  hashFull: string;
  hashArt: string;
  sig: string;
  thumb: string;
  headline: { amount: number; currency: string; source: string; asOf: string } | null;
  conditions: {
    productId: number;
    variant: string;
    rows: { condition: string; low: number; median: number; listingCount: number }[];
    fetchedAt: string;
  } | null;
  series: never[];
}

// ---------------------------------------------------------------------------
// Descriptors — identical maths to bake-offline.ts, so the two corpora mix
// ---------------------------------------------------------------------------

async function dHash(img: Sharp): Promise<string> {
  const { data } = await img
    .clone()
    .greyscale()
    .resize(HASH_GRID + 1, HASH_GRID, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let bits = '';
  for (let y = 0; y < HASH_GRID; y++) {
    for (let x = 0; x < HASH_GRID; x++) {
      const i = y * (HASH_GRID + 1) + x;
      bits += data[i]! > data[i + 1]! ? '1' : '0';
    }
  }
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

async function signature(img: Sharp): Promise<string> {
  const { data } = await img
    .clone()
    .resize(SIG_COLS, SIG_ROWS, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const n = SIG_COLS * SIG_ROWS;
  const means = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) means[c]! += data[i * 3 + c]!;
  for (let c = 0; c < 3; c++) means[c]! /= n;
  const grand = (means[0]! + means[1]! + means[2]!) / 3 || 1;

  let hex = '';
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const scaled = (data[i * 3 + c]! * grand) / (means[c]! || 1);
      hex += Math.max(0, Math.min(255, Math.round(scaled))).toString(16).padStart(2, '0');
    }
  }
  return hex;
}

async function describe(buf: Buffer) {
  const base = sharp(buf).removeAlpha();
  const meta = await base.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const art = REGIONS.artWindow;

  const artCrop = sharp(buf).removeAlpha().extract({
    left: Math.round(art.x * w),
    top: Math.round(art.y * h),
    width: Math.max(1, Math.round(art.width * w)),
    height: Math.max(1, Math.round(art.height * h)),
  });

  const [hashFull, hashArt, sig, thumb] = await Promise.all([
    dHash(base),
    dHash(artCrop),
    signature(base),
    sharp(buf).removeAlpha().resize({ width: THUMB_WIDTH }).webp({ quality: 62 }).toBuffer(),
  ]);
  return { hashFull, hashArt, sig, thumb: thumb.toString('base64') };
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

async function getJson<T>(url: string, key: string, maxAge: number): Promise<T | null> {
  const cached = readCache<T>(key);
  if (cached && cached.ageSeconds < maxAge) return cached.payload;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': TCGCSV_USER_AGENT, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as T;
    writeCache(key, data);
    return data;
  } catch {
    return cached?.payload ?? null;
  }
}

/**
 * The catalogue serves 200w and 400w; 400w is worth the bytes for hashing.
 *
 * A 404 is never retried. The catalogue lists products the image CDN has
 * nothing for — SV2a's ~165 Master Ball Pattern cards are all like this — and
 * retrying each of them six times with backoff turned a ten-minute set into a
 * half-hour one for no possible gain. Only transport failures and 5xx get
 * another go.
 */
async function fetchImage(url: string): Promise<Buffer | null> {
  const big = url.replace(/_200w\.jpg$/, '_400w.jpg');
  for (const candidate of [big, url]) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let missing = false;
      try {
        const res = await fetch(candidate, {
          headers: { 'x-retry-attempt': String(attempt), 'User-Agent': BROWSER_USER_AGENT },
          cache: 'no-store',
          signal: AbortSignal.timeout(20_000),
        });
        if (res.status === 404 || res.status === 403) { missing = true; throw new Error(`HTTP ${res.status}`); }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
      } catch {
        if (missing) break;
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      }
    }
  }
  return null;
}

interface Listing {
  price: number | null;
  condition: string | null;
  printing: string | null;
  language: string | null;
}

async function fetchListings(productId: number, condition: string): Promise<Listing[]> {
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
        term: { sellerStatus: 'Live', channelId: 0, condition: [condition] },
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

/** Per-condition prices straight from a productId, no catalogue matching. */
async function conditionPricing(productId: number) {
  const key = `tcgcsv:cond:${productId}`;
  const cached = readCache<BakedCard['conditions']>(key);
  if (cached && cached.ageSeconds < 7 * 24 * 3600) return cached.payload;

  const rows: NonNullable<BakedCard['conditions']>['rows'] = [];
  let printing = 'normal';

  for (const [condition, label] of Object.entries(CONDITION_LABELS) as [string, string][]) {
    try {
      const listings = await fetchListings(productId, label);
      const amounts = listings
        .map((l) => l.price)
        .filter((p): p is number => typeof p === 'number' && p > 0)
        .sort((a, b) => a - b);
      if (amounts.length === 0) continue;
      const seen = listings.find((l) => l.printing);
      if (seen?.printing) printing = seen.printing;
      rows.push({
        condition,
        low: amounts[0]!,
        median: amounts[Math.floor(amounts.length / 2)]!,
        listingCount: amounts.length,
      });
    } catch {
      // One condition failing must not lose the others.
    }
  }

  if (rows.length === 0) return cached?.payload ?? null;
  const result = { productId, variant: printing, rows, fetchedAt: new Date().toISOString() };
  writeCache(key, result);
  return result;
}

function extended(p: TcgProduct, name: string): string | null {
  return p.extendedData?.find((e) => e.name === name)?.value ?? null;
}

async function main(): Promise<void> {
  const targets = process.argv.slice(2).map((a) => {
    const [cat, group] = a.split(':');
    return { categoryId: Number(cat), groupId: Number(group) };
  });
  if (targets.length === 0) {
    console.error('Usage: tsx --conditions=react-server scripts/bake-tcgcsv.ts <categoryId>:<groupId>...');
    process.exit(1);
  }

  const baked: BakedCard[] = [];
  try {
    const prior = JSON.parse(readFileSync(OUT, 'utf8')) as { cards: BakedCard[] };
    baked.push(...prior.cards);
    console.log(`Resuming from ${baked.length} cards.`);
  } catch { /* clean start */ }
  const have = new Set(baked.map((c) => c.id));

  const started = Date.now();

  for (const { categoryId, groupId } of targets) {
    const groups = await getJson<{ results: TcgGroup[] }>(
      `${TCGCSV}/${categoryId}/groups`, `tcgcsv:groups:${categoryId}`, 7 * 24 * 3600,
    );
    const group = groups?.results.find((g) => g.groupId === groupId);
    const setName = group?.name ?? `Group ${groupId}`;
    const releaseDate = (group?.publishedOn ?? '').slice(0, 10);
    const language = categoryId === 85 ? 'Japanese' : 'English';

    const products = await getJson<{ results: TcgProduct[] }>(
      `${TCGCSV}/${categoryId}/${groupId}/products`,
      `tcgcsv:products:${groupId}`,
      7 * 24 * 3600,
    );
    if (!products) {
      console.warn(`  ! ${categoryId}:${groupId} — catalogue unavailable, skipped`);
      continue;
    }

    // Tell a card from a sealed product by whether it has card fields, not by
    // whether it has a collector number. The 1996 Japanese Expansion Pack and
    // its No Rarity printing carry no number at all — nothing is printed on
    // the card to carry — so requiring one silently dropped both sets, which
    // are exactly the vintage Japanese cards worth recognising.
    const cards = products.results.filter((p) =>
      p.imageUrl && ['Number', 'Rarity', 'HP', 'CardType'].some((f) => extended(p, f)),
    );
    const todo = cards.filter((p) => !have.has(`tcg-${p.productId}`));
    console.log(`${setName} (${language}): ${todo.length} of ${cards.length} to bake`);

    for (let i = 0; i < todo.length; i++) {
      const p = todo[i]!;
      const img = await fetchImage(p.imageUrl!);
      if (!img) { console.warn(`  ! ${p.productId} ${p.name} — no image`); continue; }

      let descriptors;
      try {
        descriptors = await describe(img);
      } catch {
        console.warn(`  ! ${p.productId} ${p.name} — undecodable image`);
        continue;
      }

      const conditions = await conditionPricing(p.productId);
      const numberField = extended(p, 'Number') ?? '';
      const [num, total] = numberField.split('/');

      baked.push({
        id: `tcg-${p.productId}`,
        name: p.cleanName || p.name,
        number: (num ?? '').replace(/^0+(?=\d)/, '') || numberField,
        printedTotal: Number(total) || 0,
        setName,
        setId: `tcg${groupId}`,
        releaseDate,
        rarity: extended(p, 'Rarity'),
        artist: null,
        language,
        variants: conditions ? [conditions.variant] : [],
        ...descriptors,
        headline: conditions?.rows.find((r) => r.condition === 'NM')
          ? {
              amount: conditions.rows.find((r) => r.condition === 'NM')!.median,
              currency: 'USD',
              source: 'tcgplayer',
              asOf: new Date().toISOString().slice(0, 10),
            }
          : null,
        conditions,
        series: [],
      });
      have.add(`tcg-${p.productId}`);

      // Checkpoint inside the set, not just at the end of it. A run over a
      // 500-card set is long enough to be interrupted, and losing 200 cards'
      // worth of downloads and listings calls to get back to where it already
      // was is both slow and rude to the services involved.
      if ((i + 1) % 25 === 0) {
        writeFileSync(OUT, JSON.stringify({ cards: baked, bakedAt: new Date().toISOString() }));
      }
      if ((i + 1) % 25 === 0 || i === todo.length - 1) {
        console.log(`  ${setName} ${i + 1}/${todo.length} (${baked.length} baked, ${((Date.now() - started) / 60_000).toFixed(1)}m)`);
      }
      await new Promise((r) => setTimeout(r, 120));
    }

    writeFileSync(OUT, JSON.stringify({ cards: baked, bakedAt: new Date().toISOString() }));
  }

  writeFileSync(OUT, JSON.stringify({ cards: baked, bakedAt: new Date().toISOString() }));
  const priced = baked.filter((c) => c.conditions).length;
  console.log(`\nBaked ${baked.length} cards → ${OUT}\n  with condition prices: ${priced}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
