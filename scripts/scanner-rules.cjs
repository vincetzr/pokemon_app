/** Shared by the generated scanner and its regression tests. No network or DOM. */
(function (root) {
  const variantKey = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/normal$/, '');
  function confidentPick(candidates) {
    const top = candidates && candidates[0], second = candidates && candidates[1];
    return !!top && Number.isFinite(top.score) && top.score >= 0.80 &&
      (top.probability == null || Number.isFinite(top.probability) && top.probability >= 0.90) &&
      (!second || top.score - second.score >= 0.030);
  }
  function marketEntry(card, snapshot, now = Date.now()) {
    const time = Date.parse(snapshot && snapshot.asOf);
    if (!card || !snapshot || snapshot.schema !== 1 || !Number.isFinite(time) || time > now + 300000) return null;
    const entry = snapshot.cards && snapshot.cards[card.id];
    if (!entry || entry.name !== card.name || entry.number !== card.number || entry.setName !== card.setName || entry.language !== card.language) return null;
    if (!Array.isArray(entry.quotes)) return null;
    return { ...entry, asOf: snapshot.asOf, quotes: entry.quotes.filter(q =>
      typeof q.variant === 'string' && q.currency === 'USD' && q.basis === 'market' &&
      q.condition === 'unspecified' && Number.isFinite(q.amount) && q.amount > 0) };
  }
  function selectedQuote(card, snapshot, selected, now = Date.now()) {
    const entry = marketEntry(card, snapshot, now);
    if (!entry) return null;
    const variants = new Set([...(card.variants || []), ...entry.quotes.map(q => q.variant)].map(variantKey));
    if (!selected && variants.size !== 1) return null;
    const quotes = entry.quotes.filter(q => !selected || variantKey(q.variant) === variantKey(selected));
    return quotes.length === 1 ? { ...quotes[0], asOf: entry.asOf, productId: entry.productId,
      stale: now - Date.parse(entry.asOf) > 2 * 86400000 } : null;
  }
  function bulkValue(card, snapshot, candidates, quality, now = Date.now()) {
    if (!confidentPick(candidates) || quality?.tooBlurry || quality?.tooDark) return null;
    const quote = selectedQuote(card, snapshot, undefined, now);
    return quote && !quote.stale ? quote : null;
  }
  const api = { variantKey, confidentPick, marketEntry, selectedQuote, bulkValue };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ScannerRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
