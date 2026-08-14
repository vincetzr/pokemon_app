/**
 * Build the standalone scanner: inject the baked corpus into the template and
 * write `docs/index.html`.
 *
 * The template carries placeholders rather than data so it stays hand-editable
 * — the multi-megabyte JSON island only ever exists in the built output.
 *
 *   npm run bake            # scripts/bake-offline.ts  → /tmp/bake/corpus.json
 *   npm run bake:catalogue  # scripts/bake-tcgcsv.ts   → /tmp/bake/tcgcsv.json
 *   npm run build:scanner
 *
 * Both corpora are optional inputs in the sense that the build runs without
 * the catalogue one — but it is the only source of Japanese printings and of
 * Base Set (Shadowless), which TCGplayer keeps as its own group with its own
 * product ids and therefore its own prices, so a build without it is missing
 * about a quarter of the cards. The build says so rather than leaving you to
 * notice from the count.
 */

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = resolve(ROOT, 'scripts/scanner-template.html');
const OUT = process.env.SCANNER_OUT ?? resolve(ROOT, 'docs/index.html');
const BAKE = process.env.BAKE_DIR ?? '/tmp/bake';

/**
 * Rank-normalise a plane in place: replace every value by its position in the
 * sorted order, scaled to 0-255.
 *
 * This is the whole trick. A 64-bit difference hash throws away almost all of
 * the image and still ends up sensitive to lighting; a raw template is
 * sensitive to exposure and gamma. Ranks are invariant to ANY monotonic
 * intensity transform — a colour cast, a gamma curve, an exposure shift, a
 * phone's contrast processing all preserve the ORDER of pixel brightnesses
 * even as they change every value. So comparing ranks compares the picture
 * rather than the lighting it was taken under.
 */
function rankNormalise(values) {
  const n = values.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => values[a] - values[b]);
  const out = new Uint8Array(n);
  for (let r = 0; r < n; r++) out[order[r]] = Math.round((r / (n - 1)) * 255);
  return out;
}

const toB64 = (bytes) => Buffer.from(bytes).toString('base64');

/** Descriptor grids. Small enough to embed for thousands of cards. */
const DESC_FULL = { w: 16, h: 22 };
const DESC_ART = { w: 16, h: 16 };
// A coarse grid as well: big cells tolerate the perspective residual a
// hand-held photo always carries, where a fine grid straddles it.
const DESC_COARSE = { w: 8, h: 11 };
const ART_WINDOW = { x: 0.09, y: 0.11, width: 0.82, height: 0.42 };
const THUMB_W = 68;

async function describeThumb(b64) {
  const buf = Buffer.from(b64, 'base64');
  const meta = await sharp(buf).metadata();

  const full = await sharp(buf).greyscale()
    .resize(DESC_FULL.w, DESC_FULL.h, { fit: 'fill' }).raw().toBuffer();

  const art = await sharp(buf).greyscale()
    .extract({
      left: Math.round(ART_WINDOW.x * meta.width),
      top: Math.round(ART_WINDOW.y * meta.height),
      width: Math.max(1, Math.round(ART_WINDOW.width * meta.width)),
      height: Math.max(1, Math.round(ART_WINDOW.height * meta.height)),
    })
    .resize(DESC_ART.w, DESC_ART.h, { fit: 'fill' }).raw().toBuffer();

  const coarse = await sharp(buf).greyscale()
    .resize(DESC_COARSE.w, DESC_COARSE.h, { fit: 'fill' }).raw().toBuffer();

  const thumb = await sharp(buf).resize({ width: THUMB_W }).webp({ quality: 58 }).toBuffer();

  return {
    gr: toB64(rankNormalise(Array.from(full))),
    ar: toB64(rankNormalise(Array.from(art))),
    gc: toB64(rankNormalise(Array.from(coarse))),
    thumb: thumb.toString('base64'),
  };
}

const template = readFileSync(TEMPLATE, 'utf8');

let corpus;
try {
  corpus = JSON.parse(readFileSync(`${BAKE}/corpus.json`, 'utf8'));
} catch {
  console.error(
    `No corpus at ${BAKE}/corpus.json.\n` +
    `Run \`npm run bake\` first, or point BAKE_DIR at an existing bake.`,
  );
  process.exit(1);
}

/**
 * Fold in the catalogue-sourced corpus.
 *
 * The descriptors are computed with identical maths in both bakes, so the two
 * mix without the matcher knowing or caring which produced a given card.
 */
try {
  const extra = JSON.parse(readFileSync(`${BAKE}/tcgcsv.json`, 'utf8'));
  const have = new Set(corpus.cards.map((c) => c.id));
  let added = 0;
  for (const card of extra.cards) {
    if (have.has(card.id)) continue;
    corpus.cards.push(card);
    have.add(card.id);
    added++;
  }
  console.log(`Merged ${added} cards from the TCGplayer catalogue bake.`);
} catch {
  console.warn(
    `No catalogue bake at ${BAKE}/tcgcsv.json — building from the API corpus alone.\n` +
    `  This drops every Japanese printing and Base Set (Shadowless). Run \`npm run bake:catalogue\`.`,
  );
}

// Language is what decides whether a price applies at all, so nothing is left
// to infer it later from a set name.
for (const card of corpus.cards) {
  if (!card.language) card.language = 'English';

  // The Japanese catalogue folds the collector number into the product name
  // ("Bulbasaur 001 165"), which reads as part of the Pokemon's name in a
  // candidate list. Split it back out and use it where the number is missing.
  const m = /^(.*?)\s+(\d{1,3})\s+(\d{1,3})$/.exec(card.name);
  if (m) {
    card.name = m[1];
    if (!card.number) card.number = String(Number(m[2]));
    if (!card.printedTotal) card.printedTotal = Number(m[3]);
  }
}

// Sort so search results and ties resolve predictably: oldest set first, then
// collector number, which is the order a collector reads a binder in.
corpus.cards.sort((a, b) => {
  if (a.releaseDate !== b.releaseDate) return a.releaseDate < b.releaseDate ? -1 : 1;
  const na = parseInt(a.number, 10);
  const nb = parseInt(b.number, 10);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.number.localeCompare(b.number);
});

// Build the rank descriptors from the thumbnails already baked, and shrink
// the thumbnails to pay for them. The thumbnails were the bulk of the file;
// at 68px they still identify a card at a glance, and the space buys a
// descriptor that is two orders of magnitude richer than the 64-bit hash.
{
  let done = 0;
  const CONCURRENCY = 8;
  const queue = corpus.cards.slice();
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const card = queue.shift();
      if (!card) return;
      try {
        const d = await describeThumb(card.thumb);
        card.gr = d.gr;
        card.ar = d.ar;
        card.gc = d.gc;
        card.thumb = d.thumb;
        done++;
      } catch {
        // A card without descriptors still matches on the hashes.
      }
    }
  }));
  console.log(`Built rank descriptors for ${done}/${corpus.cards.length} cards.`);
}

// `</script>` cannot appear inside the JSON island, and `<` is the only
// character that can start one.
const json = JSON.stringify(corpus).replace(/</g, '\\u003c');

const bakedAt = new Date(corpus.bakedAt).toLocaleDateString('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric',
});

// The page states what it can never recognise, so the list has to come from the
// corpus rather than from a sentence someone remembered to update.
const setNames = [...new Set(corpus.cards.map((c) => c.setName))];
const setList = setNames.join(' · ');

// Where a served copy of this page lives. The page needs this baked in for one
// case only: when it is embedded in another page, which refuses it a camera and
// leaves it unable to work out its own address. Override with SCANNER_URL.
const servedAt = process.env.SCANNER_URL
  ?? 'https://raw.githack.com/vincetzr/pokemon_app/claude/pokemon-card-auth-pricing-rpx6ib/docs/index.html';

const out = template
  .replace('__CORPUS__', () => json)
  .replace(/__CARDCOUNT__/g, String(corpus.cards.length))
  .replace(/__BAKEDATE__/g, bakedAt)
  .replace(/__SCANNERURL__/g, servedAt)
  .replace(/__SETLIST__/g, setList);

if (out.includes('__CORPUS__')) throw new Error('corpus placeholder not replaced');
if (out.includes('__SCANNERURL__')) throw new Error('scanner URL placeholder not replaced');

// The page is only served, never embedded, so it must be a whole document.
// Without a doctype a browser lays it out in quirks mode against a 980px
// viewport, which on a tablet renders the scanner shrunk into a corner.
if (!out.startsWith('<!doctype html>')) throw new Error('template lost its doctype');
if (!/<meta name="viewport"/.test(out)) throw new Error('template lost its viewport meta');

writeFileSync(OUT, out);

const sets = setNames;
const withPrices = corpus.cards.filter((c) => c.conditions && c.conditions.rows.length > 0).length;
const japanese = corpus.cards.filter((c) => c.language === 'Japanese').length;

console.log(`Built ${OUT}`);
console.log(`  ${(statSync(OUT).size / 1e6).toFixed(2)} MB`);
console.log(`  ${corpus.cards.length} cards across ${sets.length} sets`);
console.log(`  ${withPrices} with condition prices, ${japanese} Japanese`);
console.log(`  sets: ${sets.join(', ')}`);
