// Included inside the scanner script by build-scanner.mjs.
let MARKET_SNAPSHOT = null;
let MARKET_LOADING = null;
let PRICE_CARD_ID = null;
const PRINTING_SELECTION = new Map();

function loadMarketPrices() {
  if (!MARKET_LOADING) MARKET_LOADING = fetch('prices/latest.json', { cache: 'no-cache' })
    .then(r => { if (!r.ok) throw new Error('Price snapshot unavailable'); return r.json(); })
    .then(data => { if (data.schema === 1 && data.cards) MARKET_SNAPSHOT = data; })
    .catch(() => { MARKET_SNAPSHOT = null; });
  return MARKET_LOADING;
}

function selectedMarketQuote(card) {
  return ScannerRules.selectedQuote(card, MARKET_SNAPSHOT, PRINTING_SELECTION.get(card.id));
}

function renderPrices(card) {
  $('sec-price').hidden = false;
  $('price-as-card').textContent = 'Priced as ' + card.name + ' — ' + card.setName +
    (card.number ? ' #' + card.number + (card.printedTotal ? '/' + card.printedTotal : '') : '') +
    ' · ' + card.language + '. ';
  $('price-intro').textContent = 'Confirm the set, number, language and printing against your card. Market aggregates have no specific condition or grade.';
  $('price-chart').innerHTML = '';
  $('price-table').hidden = true;
  $('price-table').querySelector('tbody').innerHTML = '';
  $('price-foot').textContent = '';
  const panel = $('market-prices');
  panel.innerHTML = '';
  const entry = ScannerRules.marketEntry(card, MARKET_SNAPSHOT);
  if (!entry) {
    panel.textContent = 'No verified price snapshot is available for this card. A price for a different card or language cannot be substituted.';
    return;
  }
  const variants = new Map();
  for (const variant of [...(card.variants || []), ...entry.quotes.map(q => q.variant)]) {
    variants.set(ScannerRules.variantKey(variant), variant);
  }
  if (variants.size > 1) {
    const prompt = document.createElement('p');
    prompt.className = 'note'; prompt.textContent = 'Choose the printing on your card:'; panel.appendChild(prompt);
    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin:10px 0';
    for (const variant of variants.values()) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'ghost';
      button.textContent = variantLabel(variant);
      button.setAttribute('aria-pressed', String(ScannerRules.variantKey(PRINTING_SELECTION.get(card.id)) === ScannerRules.variantKey(variant) && PRINTING_SELECTION.has(card.id)));
      button.addEventListener('click', () => {
        PRINTING_SELECTION.set(card.id, variant); renderPrices(card);
        if (LAST_RESULT) renderSummary(LAST_RESULT, card);
      });
      controls.appendChild(button);
    }
    panel.appendChild(controls);
  }
  const quote = selectedMarketQuote(card);
  const label = document.createElement('p'); label.className = 'lede';
  label.textContent = quote ? money(quote.amount, quote.currency) + ' · ' + quote.variant +
    ' · ' + (quote.stale ? 'historical market price' : 'market price') :
    'Select a printing with a verified quote to see a price.';
  panel.appendChild(label);
  $('price-foot').textContent = 'TCGplayer via TCGCSV daily export · ' + entry.asOf.slice(0, 10) +
    ' · USD · ungraded, condition unspecified. This aggregate is not an individual sale or the value of a graded card. ';
  if (Number.isSafeInteger(entry.productId) && entry.productId > 0) {
    const link = document.createElement('a'); link.href = 'https://www.tcgplayer.com/product/' + entry.productId;
    link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'View this product on TCGplayer';
    $('price-foot').appendChild(link);
  }
  // Old corpus samples did not validate printing/language on the returned rows.
  // Only newer verified samples for the selected printing may appear.
  const sample = card.conditions;
  if (!quote || !sample?.verifiedFilters || ScannerRules.variantKey(sample.variant) !== ScannerRules.variantKey(quote.variant)) return;
  const tbody = $('price-table').querySelector('tbody');
  for (const row of sample.rows) {
    if (!Number.isFinite(row.median) || row.median <= 0 || !Number.isFinite(row.low) || row.low <= 0) continue;
    const tr = document.createElement('tr');
    for (const value of [CONDITION_LABELS[row.condition] || row.condition, money(row.low, 'USD'), money(row.median, 'USD'), row.listingCount]) {
      const td = document.createElement('td'); td.textContent = String(value); tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  $('price-table').hidden = !tbody.children.length;
  if (tbody.children.length) $('price-foot').appendChild(document.createTextNode(
    ' Listing sample captured ' + sample.fetchedAt + '. Up to 25 offers per condition, sorted by price plus shipping; amounts exclude shipping and tax.'));
}

/** Bulk totals exclude stale prices and do not use saved condition samples. */
function bestValue(card) {
  const quote = selectedMarketQuote(card);
  return quote && !quote.stale ? quote : null;
}
