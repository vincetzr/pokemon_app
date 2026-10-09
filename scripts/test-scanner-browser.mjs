import { chromium } from 'playwright';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import bwip from 'bwip-js';
import { mkdir } from 'node:fs/promises';

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
  // Synthetic code images exercise the actual bundled decoder, not mock reads.
  for (const [bcid, text, format] of [['qrcode', 'https://www.psacard.com/cert/00123456', 'QR_CODE'], ['code128', '00123456', 'CODE_128']]) {
    const png = await bwip.toBuffer({ bcid, text, scale: 4, padding: 12, backgroundcolor: 'FFFFFF' });
    const reads = await page.evaluate(async image => CardGrading.scanBarcodes(await CardGrading.imageCanvas('data:image/png;base64,' + image)), png.toString('base64'));
    assert.ok(reads.some(r => r.text === text && r.format.toUpperCase() === format), format + ' should decode from pixels');
  }
  await page.route('https://mp-search-api.tcgplayer.com/**', async route => {
    const body = route.request().postDataJSON();
    const condition = body.filters.term.condition[0], printing = body.filters.term.printing[0];
    await route.fulfill({ json: { results: [{ results: [
      { price: 12, condition, printing, language: 'English' },
      { price: 20, condition, printing, language: 'English' },
      { price: 9999, condition, printing, language: 'Japanese' },
    ] }] }, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.evaluate(async () => {
    gradingReset(); await selectCard(CARDS.find(c => c.id === 'base1-4'));
    GRADING.observations = { ...CardGrading.EMPTY_OBSERVATIONS, frontUsable: true, backUsable: true, corners: 'minor', edges: 'minor', surface: 'none', creases: 'none' };
    document.getElementById('grading-tools').open = true; renderGrading();
  });
  assert.doesNotMatch(await page.locator('#grading-price').innerText(), /\$/);
  await page.locator('#grading-confirm-wear').check();
  await page.waitForFunction(() => document.getElementById('grading-price').textContent.includes('$16.00'));
  assert.match(await page.locator('#grading-price').innerText(), /Lightly Played/);
  assert.match(await page.locator('#grading-price-note').innerText(), /2 matching offers/);
  await page.locator('#grading-wear-edges').selectOption('moderate');
  assert.equal(await page.locator('#grading-confirm-wear').isChecked(), false);
  assert.doesNotMatch(await page.locator('#grading-price').innerText(), /\$/);
  await page.locator('#grading-mode').selectOption('slab');
  await page.locator('#grading-label-text').fill('PSA\nMINT 9\nCert 00123456');
  await page.locator('#btn-parse-label').click();
  assert.equal(await page.locator('#grading-cert').inputValue(), '00123456');
  assert.equal(await page.locator('#grading-cert-link').getAttribute('href'), 'https://www.psacard.com/cert/00123456');
  assert.equal(await page.locator('#grading-confirm-label').isChecked(), false);
  await page.locator('#grading-confirm-label').check();
  assert.match(await page.locator('#grading-sold-link').getAttribute('href'), /PSA/);
  assert.doesNotMatch(await page.locator('#grading-price').innerText(), /\$/);
  assert.doesNotMatch(await page.locator('#market-prices').innerText(), /\$/);
  await page.locator('#grading-cert').fill('87654321');
  assert.equal(await page.locator('#grading-confirm-label').isChecked(), false);
  await page.locator('#grading-label-text').fill('Premier Card Grading\nGrade 8.5\nCert ABC-123456');
  await page.locator('#grading-company').selectOption('');
  await page.locator('#btn-parse-label').click();
  assert.equal(await page.locator('#grading-cert-link').getAttribute('href'), 'https://pop.premiercardgrading.com/');
  await mkdir(resolve(root, 'screenshots'), { recursive: true });
  await page.screenshot({ path: resolve(root, 'screenshots/condition-slab-mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile page should not overflow horizontally');
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: prices, printings, missing data, races, reviewed condition prices, QR/Code128 pixels, slab links, PCG and mobile layout.');
} finally { await browser.close(); }
