import type { ConditionPricing } from './sources/tcgplayer-listings';
import type { Money, PrintVariant } from '../types';

/** A holding requires its saved printing AND condition; an aggregate is not a substitute. */
export function holdingPrice(entry: { cardId: string; variant: PrintVariant; conditionKey: string }, sample: ConditionPricing | null, now = Date.now()): Money | null {
  if (!sample?.verifiedFilters || sample.cardId !== entry.cardId || sample.variant !== entry.variant || sample.language !== 'English') return null;
  const age = now - Date.parse(sample.fetchedAt);
  if (!Number.isFinite(age) || age < -300_000 || age > 86_400_000) return null;
  const price = sample.prices.find(p => `raw:${p.condition}` === entry.conditionKey)?.median;
  return price?.currency === 'USD' && Number.isFinite(price.amount) && price.amount > 0 ? price : null;
}
