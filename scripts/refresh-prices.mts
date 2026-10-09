/** Daily, server-side TCGCSV ingest. Never mix products, printings or languages. */
import { readFileSync, readdirSync, mkdirSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { matchGroup, matchProduct, type TcgCsvProduct } from '../src/lib/pricing/catalogue.ts';
import type { Card } from '../src/lib/types.ts';

const ROOT = resolve(import.meta.dirname, '..');
const target = resolve(ROOT, 'docs/prices/latest.json');
const ua = 'pokemon-card-scanner/0.1 (+https://github.com/vincetzr/pokemon_app)';
const page = readFileSync(resolve(ROOT, 'docs/index.html'), 'utf8');
const embedded = page.match(/<script[^>]*id="corpus-data"[^>]*>([\s\S]*?)<\/script>/);
if (!embedded) throw new Error('Missing scanner corpus');
type Baked = { id: string; name: string; number: string; printedTotal: number; setId: string; setName: string; releaseDate: string; language: string };
const cards = new Map<string, Baked>();
for (const card of JSON.parse(embedded[1]!).cards) cards.set(card.id, card);
for (const file of readdirSync(resolve(ROOT, 'docs/corpus')).filter(f => /^shard-.*\.json$/.test(f))) {
  const shard = JSON.parse(readFileSync(resolve(ROOT, 'docs/corpus', file), 'utf8'));
  for (const card of shard.cards ?? shard) cards.set(card.id, card);
}
const fingerprint = createHash('sha256').update('mapping-v2').update(JSON.stringify([...cards.values()].map(c =>
  [c.id,c.name,c.number,c.printedTotal,c.setId,c.setName,c.language]))).digest('hex');
async function fetchText(path: string) {
  await new Promise(r => setTimeout(r, 110));
  const res = await fetch(`https://tcgcsv.com/${path}`, { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.text();
}
const stamp = (await fetchText('last-updated.txt')).trim();
const time = new Date(stamp.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
if (!Number.isFinite(time.getTime()) || time.getTime() > Date.now() + 300_000) throw new Error('Invalid export date');
const asOf = time.toISOString();
if (existsSync(target)) {
  const previous = JSON.parse(readFileSync(target, 'utf8'));
  if (previous.asOf === asOf && previous.fingerprint === fingerprint && previous.schema === 1) {
    console.log(`Already current: ${asOf}`); process.exit(0);
  }
}
const cache = resolve(tmpdir(), 'pokemon-price-refresh', asOf.replace(/[^\d]/g, ''));
mkdirSync(cache, { recursive: true });
async function results(path: string): Promise<any[]> {
  const file = resolve(cache, path.replaceAll('/', '_') + '.json');
  const text = existsSync(file) ? readFileSync(file, 'utf8') : await fetchText(path);
  const body = JSON.parse(text);
  if (body.success !== true || !Array.isArray(body.results) || body.errors?.length) throw new Error(`Invalid export: ${path}`);
  if (!existsSync(file)) writeFileSync(file, text);
  return body.results;
}
const entries: Record<string, unknown> = {};
const batches = new Map<string, Baked[]>();
for (const categoryId of [3, 85]) {
  const groups = await results(`tcgplayer/${categoryId}/groups`);
  for (const card of cards.values()) {
    if (card.language !== (categoryId === 3 ? 'English' : 'Japanese')) continue;
    const direct = /^tcg(\d+)$/.exec(card.setId);
    const shape = { name: card.name, number: card.number, set: { name: card.setName, printedTotal: card.printedTotal, releaseDate: card.releaseDate } } as Card;
    const groupId = direct ? Number(direct[1]) : matchGroup(shape, groups);
    if (!groupId || !groups.some(g => g.groupId === groupId)) continue;
    const key = `${categoryId}/${groupId}`;
    batches.set(key, [...(batches.get(key) ?? []), card]);
  }
}
for (const [key, batch] of batches) {
  const [categoryId, groupId] = key.split('/').map(Number);
  const products = await results(`tcgplayer/${key}/products`);
  const prices = await results(`tcgplayer/${key}/prices`);
  for (const card of batch) {
    const direct = /^tcg-(\d+)$/.exec(card.id);
    const shape = { name: card.name, number: card.number, set: { printedTotal: card.printedTotal } } as Card;
    const productId = direct ? Number(direct[1]) : matchProduct(shape, products as TcgCsvProduct[]);
    const product = products.find(p => p.productId === productId);
    if (!product || product.categoryId !== categoryId || product.groupId !== groupId) continue;
    const quotes = prices.filter(p => p.productId === productId && typeof p.subTypeName === 'string' &&
      Number.isFinite(p.marketPrice) && p.marketPrice > 0).map(p => ({
        variant: p.subTypeName, amount: p.marketPrice, currency: 'USD', basis: 'market', condition: 'unspecified',
      }));
    if (!quotes.length || new Set(quotes.map(q => q.variant)).size !== quotes.length) continue;
    entries[card.id] = { productId, categoryId, groupId, name: card.name, number: card.number,
      setName: card.setName, language: card.language, quotes };
  }
  console.log(`${key}: ${batch.length} identities checked`);
}
if ((await fetchText('last-updated.txt')).trim() !== stamp) throw new Error('Export changed during sync; retry to obtain a consistent snapshot');
const snapshot = { schema: 1, asOf, fingerprint, source: 'TCGplayer via TCGCSV daily export', cards: entries,
  coverage: { catalogueCards: cards.size, verified: Object.keys(entries).length, unavailable: cards.size - Object.keys(entries).length } };
mkdirSync(resolve(ROOT, 'docs/prices'), { recursive: true });
writeFileSync(target + '.tmp', JSON.stringify(snapshot) + '\n');
renameSync(target + '.tmp', target);
console.log(JSON.stringify({ asOf, ...snapshot.coverage }));
