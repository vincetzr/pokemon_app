/**
 * Build real price history for the baked corpus from TCGCSV's daily archives.
 *
 * WHY THIS SOURCE AND NOT PRICECHARTING
 *
 * PriceCharting's chart data is genuinely reachable — it sits in a
 * `VGPC.chart_data` variable in their product HTML — and it is not ours to
 * use. Their Price Data Acceptable Use terms define price data to include
 * historical pricing "made available by PriceCharting via its website, API, or
 * downloadable content" and bar it from "any software, application, or system
 * that is accessible to third parties... including the general public". The
 * paid tier grants internal business purposes only, "not for external display
 * or redistribution". A page anyone can open is exactly what is excluded, so
 * no amount of paying fixes it. What is copyable is their METHOD, not their
 * data: take daily observed marketplace prices and a robust central estimate.
 *
 * TCGCSV publishes daily snapshots of TCGplayer's own price endpoint at
 * https://tcgcsv.com/archive/tcgplayer/prices-YYYY-MM-DD.ppmd.7z — free, no
 * key, no account. It is an unaffiliated passthrough, so the build attributes
 * TCGplayer in the page, identifies itself in the User-Agent, and ships a
 * downsampled series rather than republishing the daily feed.
 *
 * THE JOIN IS EXACT, WHICH IS THE WHOLE REASON THIS IS WORTH DOING
 *
 * Measured against a single day's archive:
 *   - 4,973 of 4,975 distinct corpus productIds are present (99.96%)
 *   - matching on (productId, subTypeName) raw gives 4,161 of 5,521 cards
 *   - with the variant map below it gives 5,519 of 5,521
 * No fuzzy name matching, no set-symbol reconciliation.
 *
 * WHAT THE COVERAGE HONESTLY IS
 *
 * Probed directly rather than taken on trust:
 *   2023-06-01  404          nothing exists before 2024-02-08
 *   2024-02-08  cat 3: 37,234 rows   cat 85: 0
 *   2024-09-16  cat 3: 39,265 rows   cat 85: 0 rows in 100 directories
 *   2025-01-07  cat 3: 39,834 rows   cat 85: 12,712 rows
 * So English history starts 2024-02-08 and Japanese starts 2025-01-07 — the
 * 2024-09-16 date that circulates for Japanese is when the group directories
 * were created, and they are empty. Every shard card is Japanese, so the whole
 * shard corpus caps at that later date. Nothing free reaches a card's launch,
 * and the page says so rather than interpolating a line back to it.
 *
 * WHY IT DOES NOT DOWNLOAD 921 ARCHIVES
 *
 * The output is downsampled to weekly for the last year and monthly before
 * that, so fetching every intervening day would decompress 3GB in order to
 * throw almost all of it away. It fetches only the days it will keep: about 70
 * archives, ~280MB, a few minutes. The 7z is solid PPMd across all 86
 * categories, so each archive decompresses whole however few files are wanted
 * — one more reason to want few days rather than few files.
 *
 * Node has no PPMd decoder, so extraction shells out to py7zr.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const WORK = join(ROOT, '.cache', 'tcgcsv');
const OUT = join(ROOT, 'docs', 'history');

const FIRST_DAY = '2024-02-08';       // measured: nothing exists before this
const CATEGORIES = ['3', '85'];       // Pokemon English, Pokemon Japan
const BUCKETS = 64;
const UA = 'pokemon-card-scanner/1.0 (+https://github.com/vincetzr/pokemon_app) build-time backfill';

/**
 * The corpus stores two different vocabularies in one field.
 *
 * bake-offline writes pokemontcg.io PRICE KEYS (`holofoil`, `1stEdition`)
 * while bake-tcgcsv writes TCGplayer SUBTYPE DISPLAY NAMES (`Holofoil`,
 * `1st Edition`). The archive speaks only the latter. Measured, this map is
 * worth 1,358 cards.
 */
const VARIANT = {
  holofoil: 'Holofoil',
  normal: 'Normal',
  reverseHolofoil: 'Reverse Holofoil',
  '1stEdition': '1st Edition',
  '1stEditionHolofoil': '1st Edition Holofoil',
  unlimited: 'Unlimited',
  unlimitedHolofoil: 'Unlimited Holofoil',
};
const subTypeOf = (v) => VARIANT[v] || v;

/* --- which days to fetch ------------------------------------------------ */

const iso = (d) => d.toISOString().slice(0, 10);

function targetDates(today) {
  const days = [];
  const first = new Date(FIRST_DAY + 'T00:00:00Z');
  const weeklyFrom = new Date(today);
  weeklyFrom.setUTCFullYear(weeklyFrom.getUTCFullYear() - 1);

  // Monthly for the older stretch: a card's price a year ago is a level, not
  // an event, and monthly is enough to draw it.
  for (let d = new Date(first); d < weeklyFrom; d.setUTCMonth(d.getUTCMonth() + 1)) {
    days.push(iso(d));
  }
  // Weekly for the last year, where the shape is what a seller is reading.
  for (let d = new Date(weeklyFrom); d < today; d.setUTCDate(d.getUTCDate() + 7)) {
    days.push(iso(d));
  }
  return [...new Set(days)];
}

/* --- corpus ------------------------------------------------------------- */

/** Every card in the shipped build that carries a TCGplayer product id. */
function readCorpus() {
  const out = new Map();
  const take = (cards) => {
    for (const c of cards || []) {
      const k = c.conditions;
      if (!k || k.productId == null) continue;
      out.set(c.id, { productId: Number(k.productId), subType: subTypeOf(k.variant) });
    }
  };

  const html = readFileSync(join(ROOT, 'docs', 'index.html'), 'utf8');
  const at = html.indexOf('id="corpus-data"');
  if (at < 0) throw new Error('no corpus-data in docs/index.html — run build:scanner first');
  const start = html.indexOf('>', at) + 1;
  take(JSON.parse(html.slice(start, html.indexOf('</script>', start))).cards);

  const shardDir = join(ROOT, 'docs', 'corpus');
  if (existsSync(shardDir)) {
    for (const f of readdirSync(shardDir)) {
      if (!/^shard-\d+\.json$/.test(f)) continue;
      take(JSON.parse(readFileSync(join(shardDir, f), 'utf8')).cards);
    }
  }
  return out;
}

/* --- one day ------------------------------------------------------------ */

async function fetchDay(date) {
  const url = `https://tcgcsv.com/archive/tcgplayer/prices-${date}.ppmd.7z`;
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${date}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const archive = join(WORK, `${date}.7z`);
  writeFileSync(archive, buf);
  return { archive, bytes: buf.length };
}

/**
 * Pull just the two categories' price files out and return them parsed.
 *
 * py7zr is driven through a here-doc rather than a temp script so this stays
 * one file, and it emits JSON on stdout so nothing has to be parsed by eye.
 */
function extractDay(archive, date) {
  const dir = join(WORK, 'x');
  rmSync(dir, { recursive: true, force: true });
  const py = `
import py7zr, re, json, os, sys
pat = re.compile(r'^\\d{4}-\\d\\d-\\d\\d/(${CATEGORIES.join('|')})/\\d+/prices$')
with py7zr.SevenZipFile(${JSON.stringify(archive)}, 'r') as z:
    names = [n for n in z.getnames() if pat.match(n)]
    if names:
        z.extract(path=${JSON.stringify(dir)}, targets=names)
rows = []
for root, _, files in os.walk(${JSON.stringify(dir)}):
    for f in files:
        with open(os.path.join(root, f)) as fh:
            for r in json.load(fh).get('results', []):
                mp = r.get('marketPrice')
                # A null market price is "no sales to average", not "worth
                # nothing". Writing it as 0 would draw a crash on the chart.
                if mp is None:
                    continue
                rows.append([r['productId'], r['subTypeName'], mp,
                             r.get('lowPrice'), r.get('highPrice')])
json.dump(rows, sys.stdout)
`;
  const stdout = execFileSync('python3', ['-c', py], {
    maxBuffer: 1 << 28, encoding: 'utf8',
  });
  rmSync(dir, { recursive: true, force: true });
  return JSON.parse(stdout);
}

/* --- main --------------------------------------------------------------- */

const today = new Date();
today.setUTCHours(0, 0, 0, 0);
const dates = targetDates(today);
const corpus = readCorpus();

// productId -> card ids, keyed on the PRODUCT rather than on the product-and-
// variant pair the card happens to have been baked with.
//
// A chart worth looking at shows every printing of a card at once, which is
// what PriceCharting does with its grade tiers: a Normal at 10c beside a
// Reverse Holofoil at 26c is the comparison a seller actually wants. 2,222 of
// the 4,975 corpus products carry more than one priced printing, and matching
// only the baked variant threw every other one away.
const wanted = new Map();
for (const [id, v] of corpus) {
  if (!wanted.has(v.productId)) wanted.set(v.productId, []);
  wanted.get(v.productId).push(id);
}

console.log(`corpus: ${corpus.size} cards with a product id, ${wanted.size} distinct products`);
console.log(`fetching ${dates.length} days: ${dates[0]} .. ${dates[dates.length - 1]}\n`);

mkdirSync(WORK, { recursive: true });
// card id -> printing -> [[dateIndex, market, low, high], ...], all in cents.
const series = new Map();
let bytes = 0, missing = 0, matchedRows = 0;

for (let i = 0; i < dates.length; i++) {
  const date = dates[i];
  let got;
  try {
    got = await fetchDay(date);
  } catch (err) {
    console.log(`  ${date}  ${err.message} — skipped`);
    continue;
  }
  if (!got) { missing++; continue; }
  bytes += got.bytes;

  let hits = 0;
  for (const [productId, subTypeName, marketPrice, lowPrice, highPrice] of
       extractDay(got.archive, date)) {
    const ids = wanted.get(productId);
    if (!ids) continue;
    // Cents, not currency units. The corpus median price is about a dollar, so
    // rounding to whole units would flatten half of it to "1".
    const cents = Math.round(marketPrice * 100);
    if (!Number.isFinite(cents) || cents <= 0) continue;
    // The band. Every archive row carries a low and a high, so the chart can
    // show the spread the market was quoting rather than a bare mean — which
    // on a thinly traded card is most of what there is to know.
    const lo = Math.round((lowPrice == null ? marketPrice : lowPrice) * 100);
    const hi = Math.round((highPrice == null ? marketPrice : highPrice) * 100);
    for (const id of ids) {
      if (!series.has(id)) series.set(id, new Map());
      const byPrinting = series.get(id);
      if (!byPrinting.has(subTypeName)) byPrinting.set(subTypeName, []);
      byPrinting.get(subTypeName).push([i, cents, Math.min(lo, cents), Math.max(hi, cents)]);
    }
    hits++;
  }
  matchedRows += hits;
  rmSync(got.archive, { force: true });
  process.stdout.write(`  [${String(i + 1).padStart(3)}/${dates.length}] ${date}  ${hits} matched\r`);
}
rmSync(WORK, { recursive: true, force: true });

console.log(`\n\ndownloaded ${(bytes / 1048576).toFixed(0)}MB across ${dates.length - missing} days` +
  (missing ? ` (${missing} had no archive)` : ''));
console.log(`matched ${matchedRows} price rows onto ${series.size} cards`);

// Buckets, so opening one card fetches a few KB rather than the whole history.
mkdirSync(OUT, { recursive: true });
const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % BUCKETS;
};

const files = Array.from({ length: BUCKETS }, () => ({}));
let points = 0, printings = 0;
for (const [id, byPrinting] of series) {
  const out = {};
  for (const [printing, pts] of byPrinting) {
    pts.sort((a, b) => a[0] - b[0]);
    // One reading per day per printing: two corpus cards can share a product.
    const seen = new Set();
    const clean = pts.filter(([d]) => (seen.has(d) ? false : (seen.add(d), true)));
    if (clean.length < 2) continue;               // a single dot is not a history
    out[printing] = clean;
    points += clean.length;
    printings++;
  }
  if (Object.keys(out).length === 0) continue;
  files[hash(id)][id] = out;
}

let total = 0;
for (let b = 0; b < BUCKETS; b++) {
  // The dates live once per bucket rather than on all 364,000 points, so each
  // point is an index plus three small integers. That is most of the size of
  // carrying three prices instead of one paid back.
  const body = JSON.stringify({
    currency: 'USD', source: 'TCGplayer via TCGCSV', dates, cards: files[b],
  });
  writeFileSync(join(OUT, `hist-${String(b).padStart(2, '0')}.json`), body);
  total += body.length;
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify({
  buckets: BUCKETS,
  cards: Object.values(files).reduce((n, f) => n + Object.keys(f).length, 0),
  points,
  firstDay: dates[0],
  lastDay: dates[dates.length - 1],
  englishFrom: FIRST_DAY,
  japaneseFrom: '2025-01-07',
  source: 'TCGplayer, via the TCGCSV daily archive',
  builtAt: new Date().toISOString(),
}, null, 1));

console.log(`wrote ${BUCKETS} buckets, ${(total / 1048576).toFixed(2)}MB total, ` +
  `${points} points across ${printings} printings of ` +
  `${Object.values(files).reduce((n, f) => n + Object.keys(f).length, 0)} cards`);
console.log(`average ${Math.round(total / Math.max(1, series.size))}B per card, fetched only when a card is opened`);
