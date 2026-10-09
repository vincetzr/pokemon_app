import { chromium } from 'playwright';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const snapshot = JSON.parse(await readFile(resolve(root, 'docs/prices/latest.json'), 'utf8'));
const browser = await chromium.launch({ headless: true, channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route('https://scanner.test/**', async route => {
  const pathname = new URL(route.request().url()).pathname;
  const path = resolve(root, 'docs', '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!path.startsWith(resolve(root, 'docs') + '/')) return route.fulfill({ status: 404 });
  try {
    await stat(path);
    await route.fulfill({ body: await readFile(path), contentType: extname(path) === '.json' ? 'application/json' : 'text/html' });
  } catch { await route.fulfill({ status: 404 }); }
});
try {
  await page.goto('https://scanner.test/');
  await page.waitForFunction(() => typeof CARDS !== 'undefined' && CARDS.length === 5577);
  assert.equal(await page.evaluate(() => document.compatMode), 'CSS1Compat');
  await page.evaluate(async () => { document.getElementById('results').hidden = false; await selectCard(CARDS.find(c => c.id === 'base1-4')); });
  assert.match(await page.locator('#market-prices').innerText(), /market price/);
  assert.ok((await page.locator('#price-foot').innerText()).includes(snapshot.asOf.slice(0, 10)));
  assert.equal(await page.locator('#price-table').isVisible(), false, 'Unverified legacy listing table must be hidden');

  await page.evaluate(async () => { await selectCard(CARDS.find(c => c.id === 'sv3pt5-25')); });
  assert.match(await page.locator('#market-prices').innerText(), /Choose the printing/);
  assert.doesNotMatch(await page.locator('#market-prices').innerText(), /\$\d/);
  await page.locator('#market-prices button').filter({ hasText: /^Normal$/ }).click();
  assert.match(await page.locator('#market-prices').innerText(), /\$\d/);

  // A late history/price response from the previous selection cannot redraw it.
  await page.evaluate(async () => {
    await Promise.all([selectCard(CARDS.find(c => c.id === 'base1-4')), selectCard(CARDS.find(c => c.id === 'base1-58'))]);
  });
  assert.match(await page.locator('#price-as-card').innerText(), /Pikachu/);
  assert.doesNotMatch(await page.locator('#history-panel').innerText(), /Charizard/);

  await page.evaluate(async () => {
    const known = CARDS.find(c => c.id === 'base1-4');
    await selectCard({ ...known, id: 'unknown', name: 'Unknown card' });
  });
  assert.match(await page.locator('#market-prices').innerText(), /No verified price/);
  assert.equal(await page.locator('#price-foot').innerText(), '');
  assert.equal(await page.locator('#price-table').isVisible(), false);

  // Exercise the summary with a weak guess, then an explicit confirmation.
  const summary = await page.evaluate(() => {
    const card = CARDS.find(c => c.id === 'base1-4');
    const result = { candidates: [{ card, score: .99, probability: .99 }], quality: {},
      report: { signals: [], ranCount: 0, totalCount: 0, scoreIsMeaningful: false } };
    renderSummary(result);
    const before = document.getElementById('sum-worth').textContent;
    renderSummary(result, card);
    return { before, after: document.getElementById('sum-worth').textContent };
  });
  assert.doesNotMatch(summary.before, /\$\d/);
  assert.match(summary.after, /market aggregate/);
  assert.doesNotMatch(summary.after, /actually paid|Near Mint/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile page should not overflow horizontally');
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: prices, printing selection, missing data, selection race, summary and mobile layout.');
} finally { await browser.close(); }
