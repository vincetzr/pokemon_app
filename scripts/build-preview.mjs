/** Portable, single-file preview: all shipped cards and dated quotes included.
 * OCR language assets and live offers still need a network connection. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
const root = resolve(import.meta.dirname, '..');
let html = readFileSync(resolve(root, 'docs/index.html'), 'utf8');
const pattern = /(<script type="application\/json" id="corpus-data">)([\s\S]*?)(<\/script>)/;
const match = pattern.exec(html);
if (!match) throw new Error('Scanner corpus not found. Build the scanner first.');
const corpus = JSON.parse(match[2]), ids = new Set(corpus.cards.map(c => c.id));
const index = JSON.parse(readFileSync(resolve(root, 'docs/corpus/index.json'), 'utf8'));
for (const name of index.shards) for (const card of JSON.parse(readFileSync(resolve(root, 'docs/corpus', name), 'utf8')).cards) if (!ids.has(card.id)) { corpus.cards.push(card); ids.add(card.id); }
const snapshot = JSON.parse(readFileSync(resolve(root, 'docs/prices/latest.json'), 'utf8'));
html = html.replace(pattern, (_s, start, _data, end) => start + JSON.stringify(corpus).replace(/</g, '\\u003c') + end);
html = html.replace('<script type="application/json" id="corpus-data">', '<script>window.__PREVIEW_PRICE_SNAPSHOT__=' + JSON.stringify(snapshot).replace(/</g, '\\u003c') + ';window.__PORTABLE_PREVIEW__=true;</script>\n<script type="application/json" id="corpus-data">');
html = html.replace("async function loadExtraCards() {", "async function loadExtraCards() { if (window.__PORTABLE_PREVIEW__) return;");
html = html.replace('>__CARDCOUNT__<', '>' + corpus.cards.length + '<');
html = html.replace(/(<[^>]+id="corpus-count"[^>]*>)[\d,]+(<\/[^>]+>)/, '$1' + corpus.cards.length + '$2');
html = html.replace('<header>', '<header><p class="note" style="border:1px solid #3987e5;padding:12px;border-radius:10px">Portable preview · ' + corpus.cards.length + ' cards included · market snapshot ' + snapshot.asOf.slice(0, 10) + '. Upload photos to scan. Label OCR and live offers need internet; camera access depends on the preview’s permissions.</p>');
const out = resolve(process.env.PREVIEW_OUT ?? resolve(root, '../pokemon-scanner-preview.html'));
mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, html);
console.log('Preview: ' + out + ' · ' + ids.size + ' cards · ' + (Buffer.byteLength(html) / 1e6).toFixed(2) + ' MB');
