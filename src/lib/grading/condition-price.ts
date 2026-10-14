import type { RawCondition } from '../types';
import { matchingAmounts, medianAmount, type Listing } from '../pricing/listing-sample';

export interface RawAskingSample {
  cardId: string; variant: string; condition: RawCondition; language: 'English';
  verifiedFilters: true; basis: 'asking'; low: number; median: number; count: number;
  asOf: string; sourceUrl: string;
}
const LABELS = { NM: 'Near Mint', LP: 'Lightly Played', MP: 'Moderately Played', HP: 'Heavily Played', DMG: 'Damaged' };
export const PRINTING_LABELS: Record<string, string> = {
  normal: 'Normal', holofoil: 'Holofoil', reverseHolofoil: 'Reverse Holofoil',
  '1stEdition': '1st Edition', '1stEditionHolofoil': '1st Edition Holofoil', unlimited: 'Unlimited', unlimitedHolofoil: 'Unlimited Holofoil',
};
export function usableRawSample(sample: RawAskingSample | null, cardId: string, variant: string, condition: RawCondition, now = Date.now()): RawAskingSample | null {
  if (!sample || sample.cardId !== cardId || sample.variant !== variant || sample.condition !== condition || sample.language !== 'English' || !sample.verifiedFilters || sample.basis !== 'asking') return null;
  const age = now - Date.parse(sample.asOf);
  return Number.isFinite(age) && age >= -300_000 && age <= 86_400_000 && Number.isFinite(sample.median) && sample.median > 0 && Number.isFinite(sample.low) && sample.low > 0 && sample.count > 0 ? sample : null;
}
/** A public product listing request. If CORS, service availability or returned
 * printing/language metadata fails, the static app leaves the price unavailable. */
export async function fetchRawAskingSample(productId: number, card: { id: string; language?: string }, variant: string, condition: RawCondition): Promise<RawAskingSample | null> {
  const printing = PRINTING_LABELS[variant];
  if (!Number.isSafeInteger(productId) || productId <= 0 || !printing || card.language !== 'English') return null;
  try {
    const response = await fetch('https://mp-search-api.tcgplayer.com/v1/product/' + productId + '/listings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ filters: { term: { sellerStatus: 'Live', channelId: 0, condition: [LABELS[condition]], printing: [printing], language: ['English'] }, range: { quantity: { gte: 1 } }, exclude: { channelExclusion: 0 } }, from: 0, size: 25, sort: { field: 'price+shipping', order: 'asc' }, context: { shippingCountry: 'US', cart: {} } }),
    });
    if (!response.ok) return null;
    const json = await response.json() as { results?: { results?: Listing[] }[] };
    const amounts = matchingAmounts(json.results?.[0]?.results ?? [], LABELS[condition], printing, 'English');
    if (!amounts.length) return null;
    return { cardId: card.id, variant, condition, language: 'English', verifiedFilters: true, basis: 'asking', low: amounts[0]!, median: medianAmount(amounts), count: amounts.length, asOf: new Date().toISOString(), sourceUrl: 'https://www.tcgplayer.com/product/' + productId };
  } catch { return null; }
}
