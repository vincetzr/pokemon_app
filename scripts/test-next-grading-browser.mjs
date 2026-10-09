import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..'), origin = 'http://127.0.0.1:3179';
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3179'], { cwd: root, stdio: 'ignore' });
let browser;
const card = { id: 'base1-4', name: 'Charizard', number: '4', set: { id: 'base1', name: 'Base', series: 'Base', printedTotal: 102, total: 102, releaseDate: '1999/01/09', images: { symbol: '', logo: '' } }, variants: ['holofoil'], rarity: 'Rare Holo', subtypes: [], images: { small: '', large: '' } };
const image = resolve(root, 'test-fixtures/cards/base1-4.png');
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { const response = await fetch(origin + '/scan'); if (response.ok) { ready = true; break; } } catch { /* startup */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, 'Production Next app should start');
  browser = await chromium.launch({ headless: true, channel: 'chromium' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route(origin + '/api/scan', route => route.fulfill({ json: {
    scanId: 'browser-fixture', capturedAt: new Date().toISOString(), card, pricing: null, auth: null, imageRef: null,
    identify: { autoSelected: true, candidates: [], warnings: [] }, quality: { warnings: [] }, detection: { method: 'contour', confidence: .9 }, throughHolder: false,
  } }));
  await page.route(origin + '/api/assess-condition', route => route.fulfill({ json: {
    observations: { corners: 'minor', edges: 'minor', surface: 'none', creases: 'none', frontUsable: true, backUsable: true, throughHolder: false, confirmed: false }, notes: 'Synthetic reviewed-wear fixture; verify both sides.',
  } }));
  const requests = [];
  await page.route(origin + '/api/condition-price', async route => {
    const body = route.request().postDataJSON(); requests.push(body);
    if (body.condition.kind === 'graded') return route.fulfill({ json: { sample: null, reason: 'No exact graded asking-price sample is available.' } });
    await route.fulfill({ json: { sample: { cardId: card.id, variant: 'holofoil', condition: body.condition.condition,
      language: 'English', verifiedFilters: true, basis: 'asking', low: 12, median: 16, count: 2, asOf: new Date().toISOString(), sourceUrl: 'https://www.tcgplayer.com/product/123' } } });
  });
  await page.goto(origin + '/scan');
  await page.locator('input[type=file]').setInputFiles(image);
  await page.getByRole('heading', { name: 'Condition & slab grading' }).waitFor();
  assert.equal(requests.length, 0, 'Unreviewed condition cannot trigger a quote');
  await page.locator('label').filter({ hasText: 'Add back photo' }).locator('input[type=file]').setInputFiles(image);
  await page.getByText('Synthetic reviewed-wear fixture; verify both sides.').waitFor();
  await page.getByLabel('I inspected both sides and confirm these observations.').check();
  await page.getByText('$16.00', { exact: true }).waitFor();
  assert.deepEqual(requests.at(-1), { cardId: 'base1-4', variant: 'holofoil', condition: { kind: 'raw', condition: 'LP' } });
  await page.getByLabel(/edges · both sides/i).selectOption('moderate');
  assert.equal(await page.getByText('$16.00', { exact: true }).count(), 0, 'Wear changes clear old price');
  await page.getByRole('button', { name: 'Slab / barcode' }).click();
  await page.getByLabel('Grading company', { exact: true }).selectOption('PSA');
  await page.getByLabel('Certificate number', { exact: false }).fill('00123456');
  await page.getByLabel('Overall printed grade', { exact: false }).selectOption('9');
  assert.equal(await page.locator('option[value="9.5"]').count(), 0, 'PSA 9.5 must not be offered');
  assert.equal(await page.getByRole('link', { name: 'Open PSA official certificate lookup' }).getAttribute('href'), 'https://www.psacard.com/cert/00123456');
  await page.getByLabel('I checked the company', { exact: false }).check();
  await page.getByText('No exact graded asking-price sample is available.', { exact: true }).waitFor();
  assert.equal(requests.at(-1).condition.kind, 'graded');
  assert.equal(requests.at(-1).condition.company, 'PSA'); assert.equal(requests.at(-1).condition.grade, 9);
  assert.equal(await page.getByText('$16.00', { exact: true }).count(), 0, 'Raw prices cannot value a slab');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mkdir(resolve(root, 'screenshots'), { recursive: true });
  await page.screenshot({ path: resolve(root, 'screenshots/next-condition-slab-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Production UI checks passed: scan upload, back review, exact raw pricing, price invalidation, PSA lookup and slab pricing separation.');
} finally { await browser?.close(); server.kill('SIGTERM'); }
