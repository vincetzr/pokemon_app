// UI shared with the portable preview. CardGrading is bundled from the same
// TypeScript rules/decoder as the Next app; no independently drifting scale.
let GRADING = { mode: 'raw', card: null, read: null, observations: { ...CardGrading.EMPTY_OBSERVATIONS }, generation: 0, selectedQuote: null };
const CONDITION_SAMPLES = new Map();
const CONDITION_LOADING = new Set();

function gradingAssessment() { return CardGrading.estimateCondition(GRADING.observations); }
function gradingVariant() {
  const card = GRADING.card; if (!card) return null;
  const quote = selectedMarketQuote(card);
  const selected = PRINTING_SELECTION.get(card.id) || (card.variants?.length === 1 ? card.variants[0] : null) || quote?.variant;
  if (!selected) return null;
  return Object.keys(CardGrading.PRINTING_LABELS).find(v => ScannerRules.variantKey(v) === ScannerRules.variantKey(selected)) || null;
}
function gradingSelectedQuote() {
  const card = GRADING.card, variant = gradingVariant(), raw = gradingAssessment().raw;
  if (!card || !variant || !raw || GRADING.mode !== 'raw') return null;
  return CardGrading.usableRawSample(CONDITION_SAMPLES.get(card.id + ':' + variant + ':' + raw), card.id, variant, raw);
}
function gradingReset() {
  const generation = GRADING.generation + 1;
  GRADING = { mode: $('grading-mode').value, card: null, read: null, observations: { ...CardGrading.EMPTY_OBSERVATIONS }, generation, selectedQuote: null };
  for (const id of ['grading-cert', 'grading-label-text', 'grading-company', 'grading-printed-grade', 'grading-designation']) $(id).value = '';
  $('grading-confirm-label').checked = false; $('grading-confirm-wear').checked = false;
  $('btn-label-photo').disabled = false;
  $('grading-back-preview').hidden = true;
  $('grading-read-codes').textContent = ''; $('grading-conflicts').textContent = '';
  $('grading-label-status').textContent = 'Add a close photo of the printed label or its QR/barcode.';
  $('grading-photo-note').textContent = 'Scan the bare card’s front first, then add a clear back photo.';
  renderGrading();
}
function gradingNewScan(result) {
  gradingReset();
  GRADING.observations.frontUsable = !result.quality?.tooBlurry && !result.quality?.tooDark && !result.quality?.hasGlare && result.cardWidthPx >= 600;
  GRADING.observations.throughHolder = !!(result.slab || result.sleeved);
  $('grading-tools').open = true;
  if (result.slab) { GRADING.mode = 'slab'; $('grading-mode').value = 'slab'; }
  renderGrading();
  if (GRADING.mode === 'slab' && result.sourceImage) {
    const source = result.sourceImage, canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
    canvas.getContext('2d').putImageData(source, 0, 0);
    void gradingReadPhoto(canvas);
  }
}
function gradingSelectCard(card) {
  GRADING.card = card;
  renderGrading();
}
function gradingSlabDetails() {
  const company = $('grading-company').value, grade = Number($('grading-printed-grade').value), cert = $('grading-cert').value.trim(), designation = $('grading-designation').value;
  const valid = CardGrading.COMPANIES.includes(company) && CardGrading.validGrade(company, grade) && !/authentic|altered/i.test(designation);
  return { company, grade, cert, designation, valid };
}
function renderGrading() {
  const slabMode = GRADING.mode === 'slab';
  $('grading-raw').hidden = slabMode; $('grading-slab').hidden = !slabMode;
  for (const part of ['corners', 'edges', 'surface']) $('grading-wear-' + part).value = GRADING.observations[part];
  $('grading-creases').value = GRADING.observations.creases;
  $('grading-confirm-wear').checked = GRADING.observations.confirmed;
  $('grading-confirm-wear').disabled = !GRADING.observations.frontUsable || !GRADING.observations.backUsable || GRADING.observations.throughHolder;
  $('btn-back-photo').disabled = GRADING.observations.throughHolder || !LAST_RESULT;
  const estimate = gradingAssessment();
  $('grading-condition').textContent = estimate.raw ? 'Estimated raw condition: ' + CONDITION_LABELS[estimate.raw] : 'Condition estimate needs review';
  const ranges = $('grading-ranges'); ranges.innerHTML = '';
  for (const range of estimate.gradeRanges) {
    const a = document.createElement('a'); a.href = CardGrading.STANDARDS[range.company]; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.style.cssText = 'padding:10px;border:1px solid #333846;border-radius:8px;font-size:12px';
    a.textContent = CardGrading.COMPANY_LABELS[range.company] + ': ' + range.low + '–' + range.high + ' screening range' + (estimate.provisional ? ' · provisional' : ' · estimate');
    ranges.appendChild(a);
  }
  $('grading-limitations').textContent = estimate.reasons.join(' ');
  const details = gradingSlabDetails();
  const url = details.company ? CardGrading.verificationUrl(details.company, details.cert) : null;
  $('grading-cert-link').hidden = !url; $('btn-copy-cert').hidden = !url;
  if (url) { $('grading-cert-link').href = url; $('grading-cert-link').textContent = 'Open ' + details.company + ' official certificate lookup ↗'; }
  $('grading-cert-help').textContent = details.company === 'PCG' ? 'Copy the certificate number into PCG’s Cert Lookup & Pop Search.' : details.company === 'BGS' ? 'Beckett’s online lookup may be unavailable during its site maintenance.' : 'Compare the record’s card, set, grade, label and images. A matching certificate number does not authenticate this holder.';
  $('grading-confirm-label').disabled = !details.valid || !url;
  const select = $('grading-printing'); select.innerHTML = '';
  const prompt = document.createElement('option'); prompt.value = ''; prompt.textContent = GRADING.card ? 'Choose the actual printing' : 'Confirm the card in the candidate list first'; select.appendChild(prompt);
  const variants = new Set(GRADING.card?.variants || []);
  const entry = GRADING.card && ScannerRules.marketEntry(GRADING.card, MARKET_SNAPSHOT);
  for (const q of entry?.quotes || []) variants.add(q.variant);
  const unique = new Map(); for (const v of variants) unique.set(ScannerRules.variantKey(v), v);
  for (const v of unique.values()) { const option = document.createElement('option'); option.value = v; option.textContent = variantLabel(v); select.appendChild(option); }
  const selected = GRADING.card && (PRINTING_SELECTION.get(GRADING.card.id) || (unique.size === 1 ? [...unique.values()][0] : null));
  if (selected) { select.value = [...unique.values()].find(v => ScannerRules.variantKey(v) === ScannerRules.variantKey(selected)) || ''; if (unique.size === 1) PRINTING_SELECTION.set(GRADING.card.id, select.value); }
  const variant = gradingVariant(), card = GRADING.card;
  const sold = $('grading-sold-link'); sold.hidden = !(slabMode && card && variant && details.valid && $('grading-confirm-label').checked);
  if (!sold.hidden) sold.href = CardGrading.soldSearchUrl({ name: card.name, setName: card.setName, number: card.number, language: card.language }, CardGrading.PRINTING_LABELS[variant], details);
  renderConditionPrice();
}
function gradingApplyRead(read) {
  GRADING.read = read;
  $('grading-company').value = read.company || '';
  $('grading-cert').value = read.certNumber || '';
  $('grading-designation').value = read.designation || '';
  gradingGradeOptions(read.grade);
  $('grading-label-text').value = read.labelText;
  $('grading-confirm-label').checked = false;
  $('grading-read-codes').textContent = read.barcodes.map(b => 'Decoded ' + b.format + ': ' + b.text).join(' · ');
  $('grading-conflicts').textContent = read.conflicts.join(' ');
  renderGrading();
}
function gradingGradeOptions(selected) {
  const select = $('grading-printed-grade'), company = $('grading-company').value;
  select.innerHTML = '<option value="">Not readable / authentication only</option>';
  if (company) for (let g = 1; g <= 10; g += .5) if (CardGrading.validGrade(company, g)) { const option = document.createElement('option'); option.value = String(g); option.textContent = String(g); select.appendChild(option); }
  if (selected != null) select.value = String(selected);
}
async function gradingReadPhoto(source) {
  const generation = GRADING.generation;
  $('btn-label-photo').disabled = true;
  $('grading-confirm-label').checked = false;
  try {
    const read = await CardGrading.readSlabPhoto(source, $('grading-company').value || null, message => { if (generation === GRADING.generation) $('grading-label-status').textContent = message; });
    if (generation !== GRADING.generation) return;
    gradingApplyRead(read);
    $('grading-label-status').textContent = read.barcodes.length ? 'Code decoded. Review the company, printed overall grade and certificate; scan the reverse if needed.' : 'No code could be decoded. Try a closer, sharper photo or enter the certificate and overall grade.';
  } catch { if (generation === GRADING.generation) $('grading-label-status').textContent = 'The photo could not be read. Use a sharp photo or enter the printed details.'; }
  finally { if (generation === GRADING.generation) $('btn-label-photo').disabled = false; }
}
async function gradingBackPhoto(file) {
  const generation = GRADING.generation;
  GRADING.observations.confirmed = false; GRADING.observations.backUsable = false;
  $('grading-photo-note').textContent = 'Inspecting the back photo…'; renderGrading();
  try {
    const image = await loadImage(file), source = imageDataFromImg(image), det = detectCard(source);
    if (generation !== GRADING.generation) return;
    const [tl, tr, br, bl] = det.corners;
    const sourceWidth = (Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(br.x - bl.x, br.y - bl.y)) / 2;
    if (looksLikeSlab(det.measuredAspect) || sourceWidth < 600 || Math.abs(det.measuredAspect - CARD_ASPECT) > .045) throw new Error('Use a sharp, unsleeved back photo at least 600 pixels wide, with the whole card on a contrasting background.');
    const rect = rectify(source, det.corners);
    const quality = assessQuality(rect);
    if (quality.tooBlurry || quality.tooDark || quality.hasGlare) throw new Error('Retake the back in focus, well lit and without glare.');
    const wear = CardGrading.inspectBackPixels(rect.data, rect.width, rect.height);
    GRADING.observations.backUsable = true;
    if (wear.usable) { GRADING.observations.edges = wear.edges; GRADING.observations.corners = wear.corners; }
    $('grading-photo-note').textContent = wear.note + ' Review the front too, then inspect surface and creases.';
    drawRectified($('grading-back-preview'), rect); $('grading-back-preview').hidden = false;
    renderGrading();
  } catch (error) { if (generation === GRADING.generation) { $('grading-photo-note').textContent = error.message || 'The back photo could not be assessed.'; renderGrading(); } }
}
function renderConditionPrice() {
  const price = $('grading-price'), note = $('grading-price-note'); price.textContent = '';
  const card = GRADING.card, variant = gradingVariant(), raw = gradingAssessment().raw;
  if (!card || !variant) { note.textContent = 'Confirm the card identity and printing before using a condition price.'; return; }
  if (GRADING.mode === 'slab') {
    const details = gradingSlabDetails();
    note.textContent = $('grading-confirm-label').checked && details.valid
      ? 'Label reading: ' + details.company + ' ' + details.grade + ' ' + details.designation + '. No exact graded price feed is available in this standalone file. Review sold comparables; the raw aggregate is not the slab’s value.'
      : 'Confirm the company, overall printed grade, designation and certificate. Photo estimates are not used as certified slab grades.';
    return;
  }
  if (!raw) { note.textContent = 'Add the back photo, inspect all attributes and confirm the condition first. No condition price is inferred from a market average.'; return; }
  const quote = gradingSelectedQuote(), key = card.id + ':' + variant + ':' + raw;
  if (quote) {
    price.textContent = CONDITION_LABELS[raw] + ' · ' + money(quote.median, 'USD') + ' sample median asking price';
    note.textContent = 'TCGplayer · ' + quote.count + ' matching offers · lowest ' + money(quote.low, 'USD') + ' · ' + quote.asOf.slice(0, 10) + ' · ' + variantLabel(variant) + ' · English · USD. Asking prices, not completed sales; shipping and tax excluded.';
    return;
  }
  note.textContent = CONDITION_LOADING.has(key) ? 'Finding offers for the reviewed condition…' : 'No fresh verified condition offer is available. Refresh offers or view the product; no raw average or multiplier is substituted.';
}
async function gradingRefreshPrice() {
  const card = GRADING.card, variant = gradingVariant(), raw = gradingAssessment().raw;
  if (!card || !variant || !raw || GRADING.mode !== 'raw') return renderConditionPrice();
  const entry = ScannerRules.marketEntry(card, MARKET_SNAPSHOT); if (!entry) return renderConditionPrice();
  const key = card.id + ':' + variant + ':' + raw, generation = GRADING.generation;
  if (CONDITION_LOADING.has(key)) return;
  CONDITION_LOADING.add(key); renderConditionPrice();
  try {
    const quote = await CardGrading.fetchRawAskingSample(entry.productId, card, variant, raw);
    if (quote) CONDITION_SAMPLES.set(key, quote);
  } finally {
    CONDITION_LOADING.delete(key);
    if (generation === GRADING.generation) {
      renderConditionPrice(); if (LAST_RESULT && GRADING.card?.id === card.id) renderSummary(LAST_RESULT, GRADING.card);
    }
  }
}
for (const part of ['corners', 'edges', 'surface']) {
  const label = document.createElement('label'); label.style.cssText = 'display:block;margin:12px 0'; label.textContent = part[0].toUpperCase() + part.slice(1) + ' · both sides';
  const select = document.createElement('select'); select.id = 'grading-wear-' + part; select.style.cssText = 'width:100%;margin-top:5px';
  for (const [value, text] of Object.entries(CardGrading.WEAR_LABELS)) { const option = document.createElement('option'); option.value = value; option.textContent = text; select.appendChild(option); }
  select.addEventListener('change', () => { GRADING.observations[part] = select.value; GRADING.observations.confirmed = false; renderGrading(); if (LAST_RESULT && GRADING.card) renderSummary(LAST_RESULT, GRADING.card); });
  label.appendChild(select); $('grading-wear-fields').appendChild(label);
}
$('grading-creases').addEventListener('change', () => { GRADING.observations.creases = $('grading-creases').value; GRADING.observations.confirmed = false; renderGrading(); });
$('grading-confirm-wear').addEventListener('change', () => { GRADING.observations.confirmed = $('grading-confirm-wear').checked; renderGrading(); if (LAST_RESULT && GRADING.card) renderSummary(LAST_RESULT, GRADING.card); void gradingRefreshPrice(); });
$('grading-mode').addEventListener('change', () => { GRADING.generation++; GRADING.mode = $('grading-mode').value; $('grading-confirm-label').checked = false; $('btn-label-photo').disabled = false; renderGrading(); if (GRADING.card) renderPrices(GRADING.card); if (LAST_RESULT && GRADING.card) renderSummary(LAST_RESULT, GRADING.card); });
$('btn-back-photo').addEventListener('click', () => $('file-back').click());
$('file-back').addEventListener('change', e => { const file = e.target.files[0]; e.target.value = ''; if (file) void gradingBackPhoto(file); });
$('btn-label-photo').addEventListener('click', () => $('file-slab-label').click());
$('file-slab-label').addEventListener('change', e => { const file = e.target.files[0]; e.target.value = ''; if (file) void gradingReadPhoto(file); });
$('btn-parse-label').addEventListener('click', () => gradingApplyRead(CardGrading.parseSlab($('grading-label-text').value, GRADING.read?.barcodes || [], $('grading-company').value || null)));
$('grading-company').addEventListener('change', () => {
  const company = $('grading-company').value;
  const parsed = CardGrading.parseSlab(GRADING.read?.labelText || '', GRADING.read?.barcodes || [], company || null);
  $('grading-cert').value = parsed.company === company ? parsed.certNumber || '' : '';
  $('grading-conflicts').textContent = parsed.conflicts.join(' '); $('grading-confirm-label').checked = false;
  gradingGradeOptions(parsed.company === company ? parsed.grade : null); renderGrading();
});
for (const id of ['grading-cert', 'grading-printed-grade', 'grading-designation']) $(id).addEventListener(id === 'grading-cert' ? 'input' : 'change', () => { $('grading-confirm-label').checked = false; renderGrading(); });
$('grading-confirm-label').addEventListener('change', () => renderGrading());
$('grading-printing').addEventListener('change', () => {
  if (!GRADING.card) return; PRINTING_SELECTION.set(GRADING.card.id, $('grading-printing').value); renderPrices(GRADING.card); renderGrading();
  if (LAST_RESULT) renderSummary(LAST_RESULT, GRADING.card); void gradingRefreshPrice();
});
$('btn-copy-cert').addEventListener('click', async () => {
  const cert = $('grading-cert').value.trim();
  try { await navigator.clipboard.writeText(cert); $('grading-cert-help').textContent = 'Copied ' + cert + '. Paste it into the official lookup.'; }
  catch { $('grading-cert').focus(); $('grading-cert').select(); $('grading-cert-help').textContent = 'Select and copy ' + cert + ' into the official lookup.'; }
});
$('btn-refresh-condition').addEventListener('click', () => void gradingRefreshPrice());
renderGrading();
