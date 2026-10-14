import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-fake-device-for-media-stream'] });
const contexts = [];
async function cameraPage(setup) {
  const context = await browser.newContext({ permissions: ['camera'], viewport: { width: 390, height: 844 } });
  contexts.push(context);
  await context.route('https://scanner.test/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const path = resolve(root, 'docs', '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(resolve(root, 'docs') + '/')) return route.fulfill({ status: 404 });
    try { await route.fulfill({ body: await readFile(path), contentType: extname(path) === '.json' ? 'application/json' : 'text/html' }); }
    catch { await route.fulfill({ status: 404 }); }
  });
  const page = await context.newPage();
  if (setup) await page.addInitScript(setup);
  return page;
}
async function assertPhotoPicker(page, target) {
  const event = page.waitForEvent('filechooser');
  await target.click();
  const chooser = await event;
  assert.equal(await chooser.element().getAttribute('id'), 'file-camera');
  assert.equal(await chooser.element().getAttribute('capture'), 'environment');
  await chooser.setFiles([]);
}
const deferredCamera = () => {
  window.__cameraRequests = 0;
  window.__stopped = 0;
  navigator.mediaDevices.getUserMedia = () => {
    window.__cameraRequests++;
    return new Promise(resolve => {
      window.__supplyCamera = () => resolve({ getTracks: () => [{ stop: () => window.__stopped++ }] });
    });
  };
};
try {
  const missing = await cameraPage(() => Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true }));
  await missing.goto('https://scanner.test/');
  assert.match(await missing.locator('#capture-target').innerText(), /Take a photo/);
  await assertPhotoPicker(missing, missing.locator('#capture-target'));
  assert.match(await missing.locator('#capture-note').innerText(), /does not expose a live camera/);

  // A real iframe policy denial must lead to photo capture without asking for a stream.
  const embedded = await cameraPage();
  await embedded.route('https://host.test/', route => route.fulfill({
    body: '<!doctype html><iframe src="https://scanner.test/" allow="camera \'none\'" style="width:390px;height:844px"></iframe>',
    contentType: 'text/html', headers: { 'Permissions-Policy': 'camera=()' },
  }));
  await embedded.goto('https://host.test/');
  const frame = embedded.frameLocator('iframe');
  await frame.locator('#capture-target').waitFor();
  assert.match(await frame.locator('#capture-note').innerText(), /preview blocks live camera/);
  await assertPhotoPicker(embedded, frame.locator('#capture-target'));
  const libraryEvent = embedded.waitForEvent('filechooser');
  await frame.locator('#btn-library').click();
  const library = await libraryEvent;
  assert.equal(await library.element().getAttribute('id'), 'file-library');
  assert.equal(await library.element().getAttribute('capture'), null);
  await library.setFiles([]);

  const denied = await cameraPage(() => {
    window.__cameraRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      window.__cameraRequests++;
      throw new DOMException('Denied by the user', 'NotAllowedError');
    };
  });
  await denied.goto('https://scanner.test/');
  assert.equal(await denied.evaluate(() => window.__cameraRequests), 0, 'Do not ask on page load');
  await denied.locator('#capture-target').click();
  await denied.waitForFunction(() => !document.getElementById('btn-retry-camera').disabled);
  assert.equal(await denied.evaluate(() => window.__cameraRequests), 1, 'A refusal must not retry');
  assert.match(await denied.locator('#capture-note').innerText(), /access was refused/);
  await assertPhotoPicker(denied, denied.locator('#btn-use-photo'));

  const portable = await cameraPage(() => { window.__PORTABLE_PREVIEW__ = true; });
  await portable.goto('https://scanner.test/');
  await assertPhotoPicker(portable, portable.locator('#capture-target'));
  assert.equal(await portable.locator('#btn-use-photo').isVisible(), true);

  const delayed = await cameraPage(deferredCamera);
  await delayed.goto('https://scanner.test/');
  await delayed.locator('#capture-target').click();
  await delayed.waitForFunction(() => window.__cameraRequests === 1);
  await assertPhotoPicker(delayed, delayed.locator('#btn-use-photo'));
  await delayed.evaluate(() => window.__supplyCamera());
  await delayed.waitForFunction(() => window.__stopped === 1);
  assert.equal(await delayed.locator('#sec-camera').isVisible(), false, 'Do not reopen after switching to photos');

  const timeout = await cameraPage(deferredCamera);
  await timeout.clock.install();
  await timeout.goto('https://scanner.test/');
  await timeout.locator('#capture-target').click();
  await timeout.waitForFunction(() => window.__cameraRequests === 1);
  await timeout.clock.fastForward(20001);
  await timeout.waitForFunction(() => !document.getElementById('btn-retry-camera').disabled);
  assert.match(await timeout.locator('#capture-note').innerText(), /did not respond in time/);
  await timeout.evaluate(() => window.__supplyCamera());
  await timeout.waitForFunction(() => window.__stopped === 1);

  // A permitted stream still opens the real video element and is released on close.
  const live = await cameraPage();
  await live.goto('https://scanner.test/');
  assert.equal(await live.locator('#sec-camera').isVisible(), false);
  await live.locator('#capture-target').click();
  await live.waitForFunction(() => CAM.running && document.getElementById('video').videoWidth > 0);
  await live.evaluate(() => { window.__track = CAM.track; });
  await live.locator('#btn-cam-close').click();
  assert.equal(await live.evaluate(() => window.__track.readyState), 'ended');
  console.log('Camera browser checks passed: missing API, iframe policy denial, refused permission, native photo picker, portable preview, late-stream cleanup, timeout and permitted video.');
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}
