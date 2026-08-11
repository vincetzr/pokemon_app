/**
 * Bake a self-contained offline corpus for the shareable scanner.
 *
 * The published preview runs inside a sandbox that blocks every outbound
 * request, so nothing it shows can be fetched at view time. Rather than fake
 * the data, this script captures it: for each card in the target sets it
 * records the real catalogue entry, the real per-condition listing prices, the
 * real price history, a thumbnail, and the perceptual descriptors the browser
 * needs to recognise a photograph of that card without any network at all.
 *
 * The descriptors are the interesting part. Identification normally leans on
 * OCR, which needs a multi-megabyte model download — impossible offline. A
 * difference hash of the official card image is 8 bytes, so an entire set's
 * worth of them costs less than a single thumbnail, and matching is a Hamming
 * distance the phone computes in microseconds.
 *
 *   npx tsx --conditions=react-server scripts/bake-offline.ts base1 base2 base3
 */

import sharp, { type Sharp } from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { searchRawCards, toCard, type RawCard } from '../src/lib/tcg-api';
import { buildPricing } from '../src/lib/pricing/engine';
import { fetchConditionPricing } from '../src/lib/pricing/sources/tcgplayer-listings';
import { REGIONS } from '../src/lib/card-geometry';
import type { Card, PrintVariant } from '../src/lib/types';

const OUT = process.env.BAKE_OUT ?? '/tmp/bake/corpus.json';

/** Thumbnail width. Large enough to recognise a card, small enough to embed. */
const THUMB_WIDTH = 104;

/** dHash grid: (GRID+1) x GRID greyscale samples give GRID*GRID comparison bits. */
const HASH_GRID = 8;

/** Colour-layout signature grid. Coarse on purpose — it survives bad lighting. */
const SIG_COLS = 4;
const SIG_ROWS = 6;

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
  variants: PrintVariant[];
  /** 64-bit difference hash of the whole card, hex. */
  hashFull: string;
  /** 64-bit difference hash of the illustration window, hex. */
  hashArt: string;
  /** SIG_COLS x SIG_ROWS mean RGB, hex, gray-world normalised. */
  sig: string;
  thumb: string;
  headline: { amount: number; currency: string; source: string; asOf: string } | null;
  conditions: {
    productId: number;
    variant: PrintVariant;
    rows: { condition: string; low: number; median: number; listingCount: number }[];
    fetchedAt: string;
  } | null;
  series: {
    variant: PrintVariant;
    currency: string;
    points: { date: string; amount: number; provenance: string; source: string }[];
  }[];
}

// ---------------------------------------------------------------------------
// Perceptual descriptors
// ---------------------------------------------------------------------------

/**
 * Difference hash: compare each greyscale sample with its right-hand neighbour
 * and keep the sign. Robust to brightness and contrast shifts — which is the
 * whole point, because a phone photo of a card under a lamp shares almost no
 * absolute pixel values with the official scan.
 */
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
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

/**
 * Coarse colour-layout signature, gray-world normalised.
 *
 * Normalising each channel to a common mean is what makes this comparable
 * across a daylight scan and a photo taken under a warm bulb; without it the
 * signature mostly encodes the colour of the room.
 */
async function signature(img: Sharp): Promise<string> {
  const { data } = await img
    .clone()
    .resize(SIG_COLS, SIG_ROWS, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const n = SIG_COLS * SIG_ROWS;
  const means = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) means[c]! += data[i * 3 + c]!;
  }
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

async function describe(buf: Buffer): Promise<{ hashFull: string; hashArt: string; sig: string; thumb: string }> {
  const base = sharp(buf).removeAlpha();
  const meta = await base.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;

  const art = REGIONS.artWindow;
  const artCrop = sharp(buf)
    .removeAlpha()
    .extract({
      left: Math.round(art.x * w),
      top: Math.round(art.y * h),
      width: Math.max(1, Math.round(art.width * w)),
      height: Math.max(1, Math.round(art.height * h)),
    });

  const [hashFull, hashArt, sig, thumbBuf] = await Promise.all([
    dHash(base),
    dHash(artCrop),
    signature(base),
    sharp(buf).removeAlpha().resize({ width: THUMB_WIDTH }).webp({ quality: 62 }).toBuffer(),
  ]);

  return { hashFull, hashArt, sig, thumb: thumbBuf.toString('base64') };
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

async function fetchImage(url: string): Promise<Buffer | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'x-retry-attempt': String(attempt) },
        cache: 'no-store',
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  return null;
}

/**
 * All cards in a set, paged. The API 404s above pageSize 100, and returns 500
 * often enough that a single unretried page failure would otherwise abort a
 * half-hour run — so each page gets its own retry ladder and a failed page
 * costs that page rather than the whole set.
 */
async function cardsInSet(setId: string): Promise<RawCard[]> {
  const all: RawCard[] = [];

  for (let page = 1; page <= 20; page++) {
    let got: { cards: RawCard[]; totalCount: number } | null = null;

    for (let attempt = 0; attempt < 5 && !got; attempt++) {
      try {
        got = await searchRawCards({ setId }, { page, pageSize: 100, orderBy: 'number' });
      } catch {
        await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
      }
    }

    if (!got) {
      console.warn(`  ! ${setId} page ${page} unavailable after 5 attempts — continuing without it`);
      break;
    }

    all.push(...got.cards);
    if (all.length >= got.totalCount || got.cards.length === 0) break;
  }

  return all;
}

/** The printing most people mean when they ask what a card is worth. */
function primaryVariant(card: Card): PrintVariant {
  const order: PrintVariant[] = [
    'holofoil',
    '1stEditionHolofoil',
    'unlimitedHolofoil',
    'normal',
    '1stEdition',
    'unlimited',
    'reverseHolofoil',
  ];
  for (const v of order) if (card.variants.includes(v)) return v;
  return card.variants[0] ?? 'normal';
}

async function bakeCard(raw: RawCard): Promise<BakedCard | null> {
  const card = toCard(raw);

  const imgBuf = await fetchImage(card.images.large ?? card.images.small);
  if (!imgBuf) {
    console.warn(`  ! ${card.id} — no image, skipped`);
    return null;
  }

  const descriptors = await describe(imgBuf);
  const pricing = buildPricing(raw, { record: false });
  const variant = primaryVariant(card);

  let conditions: BakedCard['conditions'] = null;
  try {
    const cp = await fetchConditionPricing(card, variant, { maxAgeSeconds: 7 * 24 * 3600 });
    if (cp) {
      conditions = {
        productId: cp.productId,
        variant: cp.variant,
        rows: cp.prices.map((p) => ({
          condition: p.condition,
          low: p.low.amount,
          median: p.median.amount,
          listingCount: p.listingCount,
        })),
        fetchedAt: cp.fetchedAt,
      };
    }
  } catch {
    // A card without condition data still deserves its catalogue entry.
  }

  // Keep only series with enough real points in a single currency to draw.
  const series: BakedCard['series'] = [];
  for (const s of pricing.series) {
    for (const currency of ['USD', 'EUR'] as const) {
      const points = s.points.filter((p) => p.price.currency === currency);
      if (points.length < 2) continue;
      series.push({
        variant: s.variant,
        currency,
        points: points.map((p) => ({
          date: p.date,
          amount: p.price.amount,
          provenance: p.provenance,
          source: p.source,
        })),
      });
    }
  }

  return {
    id: card.id,
    name: card.name,
    number: card.number,
    printedTotal: card.set.printedTotal,
    setName: card.set.name,
    setId: card.set.id,
    releaseDate: card.set.releaseDate.replace(/\//g, '-'),
    rarity: card.rarity,
    artist: card.artist,
    variants: card.variants,
    ...descriptors,
    headline: pricing.headline
      ? {
          amount: pricing.headline.price.amount,
          currency: pricing.headline.price.currency,
          source: pricing.headline.source,
          asOf: pricing.headline.asOf,
        }
      : null,
    conditions,
    series,
  };
}

async function main(): Promise<void> {
  const setIds = process.argv.slice(2);
  if (setIds.length === 0) {
    console.error('Usage: tsx --conditions=react-server scripts/bake-offline.ts <setId>...');
    process.exit(1);
  }

  // Resume from a previous run. Upstream flakiness makes a long bake likely to
  // be interrupted at least once, and re-fetching several hundred images and
  // listings to recover work already on disk would be both slow and rude.
  const baked: BakedCard[] = [];
  try {
    const prior = JSON.parse(readFileSync(OUT, 'utf8')) as { cards: BakedCard[] };
    baked.push(...prior.cards);
    console.log(`Resuming from ${baked.length} cards already baked.`);
  } catch {
    // No usable checkpoint; start clean.
  }
  const have = new Set(baked.map((c) => c.id));

  const started = Date.now();

  for (const setId of setIds) {
    const raws = (await cardsInSet(setId)).filter((r) => !have.has(r.id));
    console.log(`${setId}: ${raws.length} cards to bake`);

    for (let i = 0; i < raws.length; i++) {
      const out = await bakeCard(raws[i]!);
      if (out) {
        baked.push(out);
        have.add(out.id);
      }
      if ((i + 1) % 10 === 0 || i === raws.length - 1) {
        const mins = ((Date.now() - started) / 60_000).toFixed(1);
        console.log(`  ${setId} ${i + 1}/${raws.length} (${baked.length} baked, ${mins}m)`);
      }
      // Pace the borrowed listings endpoint.
      await new Promise((r) => setTimeout(r, 120));
    }

    // Checkpoint after every set so a late failure never costs the whole run.
    writeFileSync(OUT, JSON.stringify({ cards: baked, bakedAt: new Date().toISOString() }));
  }

  const withConditions = baked.filter((c) => c.conditions).length;
  const withSeries = baked.filter((c) => c.series.length > 0).length;
  const bytes = JSON.stringify({ cards: baked }).length;

  writeFileSync(OUT, JSON.stringify({ cards: baked, bakedAt: new Date().toISOString() }));
  console.log(
    `\nBaked ${baked.length} cards → ${OUT} (${(bytes / 1e6).toFixed(2)} MB)\n` +
      `  condition prices: ${withConditions}\n  price history: ${withSeries}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
