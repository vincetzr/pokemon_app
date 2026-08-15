/**
 * Split a baked corpus into shards that sit beside the page and are fetched
 * after it is running.
 *
 * The page carries a corpus of its own and works without any of this. These
 * shards only widen what it recognises, which is why the loader treats every
 * failure as "no extra cards" rather than as an error: a missing directory, a
 * host that will not serve JSON, or a page opened from a local file all land in
 * the same place, and the scanner is unaffected.
 *
 *   node scripts/build-shards.mjs <bake.json> [outDir] [cardsPerShard]
 *
 * Cards already baked into the page are skipped, so a shard never ships a
 * second copy of something the reader has already downloaded.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2] || '/tmp/bake-shards/tcgcsv.json';
const OUT = process.argv[3] || resolve(ROOT, 'docs/corpus');
const PER_SHARD = Number(process.argv[4] || 400);

/* The descriptor maths is the same as build-scanner.mjs, because the matcher
   compares these against cards baked by that script and cannot be told which
   produced a given entry. */
const DESC_FULL = { w: 16, h: 22 };
const DESC_ART = { w: 16, h: 16 };
const DESC_COARSE = { w: 8, h: 11 };
const ART_WINDOW = { x: 0.09, y: 0.11, width: 0.82, height: 0.42 };
const THUMB_W = 68;

function rankNormalise(values) {
  const n = values.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => values[a] - values[b]);
  const out = new Uint8Array(n);
  for (let r = 0; r < n; r++) out[order[r]] = Math.round((r / (n - 1)) * 255);
  return out;
}
const toB64 = (bytes) => Buffer.from(bytes).toString('base64');

async function describeThumb(b64) {
  const buf = Buffer.from(b64, 'base64');
  const meta = await sharp(buf).metadata();
  const full = await sharp(buf).greyscale().resize(DESC_FULL.w, DESC_FULL.h, { fit: 'fill' }).raw().toBuffer();
  const art = await sharp(buf).greyscale().extract({
    left: Math.round(ART_WINDOW.x * meta.width),
    top: Math.round(ART_WINDOW.y * meta.height),
    width: Math.max(1, Math.round(ART_WINDOW.width * meta.width)),
    height: Math.max(1, Math.round(ART_WINDOW.height * meta.height)),
  }).resize(DESC_ART.w, DESC_ART.h, { fit: 'fill' }).raw().toBuffer();
  const coarse = await sharp(buf).greyscale().resize(DESC_COARSE.w, DESC_COARSE.h, { fit: 'fill' }).raw().toBuffer();
  const thumb = await sharp(buf).resize({ width: THUMB_W }).webp({ quality: 58 }).toBuffer();
  return {
    gr: toB64(rankNormalise(Array.from(full))),
    ar: toB64(rankNormalise(Array.from(art))),
    gc: toB64(rankNormalise(Array.from(coarse))),
    thumb: thumb.toString('base64'),
  };
}

const built = readFileSync(resolve(ROOT, 'docs/index.html'), 'utf8');
const already = new Set();
{
  // Which ids the page already carries, read from the page itself rather than
  // from a bake that may no longer exist.
  const m = built.match(/<script type="application\/json" id="corpus-data">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no corpus island in docs/index.html');
  const corpus = JSON.parse(m[1].replace(/\\u003c/g, '<'));
  for (const c of corpus.cards) already.add(c.id);
  console.log(`page already carries ${already.size} cards`);
}

const extra = JSON.parse(readFileSync(SRC, 'utf8'));
const fresh = [];
for (const card of extra.cards) {
  if (already.has(card.id)) continue;
  if (!card.language) card.language = 'English';
  const m = /^(.*?)\s+(\d{1,3})\s+(\d{1,3})$/.exec(card.name);
  if (m) {
    card.name = m[1];
    if (!card.number) card.number = String(Number(m[2]));
    if (!card.printedTotal) card.printedTotal = Number(m[3]);
  }
  try {
    const d = await describeThumb(card.thumb);
    card.gr = d.gr; card.ar = d.ar; card.gc = d.gc; card.thumb = d.thumb;
  } catch { /* a card without descriptors still matches on the hashes */ }
  fresh.push(card);
}

fresh.sort((a, b) => {
  if (a.releaseDate !== b.releaseDate) return a.releaseDate < b.releaseDate ? -1 : 1;
  const na = parseInt(a.number, 10), nb = parseInt(b.number, 10);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return String(a.number).localeCompare(String(b.number));
});

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (/^(index|shard-)/.test(f)) unlinkSync(join(OUT, f));

const shards = [];
for (let i = 0; i < fresh.length; i += PER_SHARD) {
  const name = `shard-${String(shards.length).padStart(3, '0')}.json`;
  writeFileSync(join(OUT, name), JSON.stringify({ cards: fresh.slice(i, i + PER_SHARD) }));
  shards.push(name);
}
const setNames = [...new Set(fresh.map((c) => c.setName))];
writeFileSync(join(OUT, 'index.json'), JSON.stringify({
  cards: fresh.length, setCount: setNames.length, sets: setNames, shards,
}, null, 1));

let bytes = 0;
for (const s of shards) bytes += readFileSync(join(OUT, s)).length;
console.log(`wrote ${shards.length} shards, ${fresh.length} cards, ${(bytes / 1e6).toFixed(2)}MB across ${setNames.length} sets`);
console.log(setNames.join(' · '));
