import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import sharp, { type Sharp } from 'sharp';
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const rules = createRequire(import.meta.url)('../../../scripts/scanner-rules.cjs');
const root = process.cwd();
const template = readFileSync(`${root}/scripts/scanner-template.html`, 'utf8');
const built = readFileSync(`${root}/docs/index.html`, 'utf8');
const corpus = JSON.parse(built.match(/<script[^>]*id="corpus-data"[^>]*>([\s\S]*?)<\/script>/)![1]!).cards;
const all = new Map(corpus.map((c: any) => [c.id, c]));
for (const file of readdirSync(`${root}/docs/corpus`).filter(f => /^shard-.*\.json$/.test(f))) {
  for (const c of JSON.parse(readFileSync(`${root}/docs/corpus/${file}`, 'utf8')).cards) all.set(c.id, c);
}
class Pixels {
  data: Uint8ClampedArray;
  constructor(public width: number, public height: number) { this.data = new Uint8ClampedArray(width * height * 4); }
}
const context = createContext({ ImageData: Pixels, CARDS: [...all.values()], REGIONS: { artWindow: { x: .09, y: .11, width: .82, height: .42 } } });
// Execute the actual shipped matcher, not a reimplementation of it.
const resize = template.slice(template.indexOf('function boxResize('), template.indexOf('\n/* ===', template.indexOf('function boxResize(')));
const matcher = template.slice(template.indexOf('function dHashFrom('), template.indexOf('function rotate180('));
runInContext(resize + '\n' + matcher, context);
async function match(image: Sharp) {
  const { data, info } = await image.resize(360, 503, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  context.image = { data: new Uint8ClampedArray(data), width: info.width, height: info.height };
  return runInContext('matchCard(describeRectified(image), 5)', context) as any[];
}
const ids = ['base1-2', 'base1-4', 'base1-58', 'swsh45-18', 'sv3pt5-6'];
const available = ids.every(id => existsSync(`${root}/test-fixtures/cards/${id}.png`));
describe.skipIf(!available)('standalone recognition on independent catalogue images', () => {
  it.each(ids)('keeps the exact %s identity in the shortlist after JPEG compression', async id => {
    const bytes = await sharp(`${root}/test-fixtures/cards/${id}.png`).jpeg({ quality: 55 }).toBuffer();
    const candidates = await match(sharp(bytes));
    const expected: any = all.get(id);
    const sameIdentity = (c: any) => c.card.name === expected.name && c.card.number === expected.number &&
      c.card.setName === expected.setName && c.card.language === expected.language;
    expect(candidates.some(sameIdentity), JSON.stringify(candidates.map(c => [c.card.id, c.score]))).toBe(true);
    if (rules.confidentPick(candidates)) expect(sameIdentity(candidates[0])).toBe(true);
  }, 15_000);
  it('abstains on a blank image instead of assigning the closest catalogue card', async () => {
    const candidates = await match(sharp({ create: { width: 360, height: 503, channels: 3, background: '#c0c0c0' } }));
    expect(rules.confidentPick(candidates)).toBe(false);
  });
});
