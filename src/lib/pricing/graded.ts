import type { Card, GradedCondition, PrintVariant } from '../types';
import { companyFromText, validGrade } from '../grading/rules';
import { medianAmount } from './listing-sample';
import { PRINTING_LABELS } from '../grading/condition-price';

export interface GradedItem {
  itemId?: string; title?: string; conditionId?: string; itemWebUrl?: string;
  price?: { value: string; currency: string }; buyingOptions?: string[];
  estimatedAvailabilities?: { estimatedAvailabilityStatus?: string }[];
  localizedAspects?: { name: string; value: string }[];
  conditionDescriptors?: { name: string; values: { content: string }[] }[];
}
export interface GradedAskingSample {
  cardId: string; variant: PrintVariant; graded: GradedCondition;
  median: number; low: number; count: number; currency: 'USD'; basis: 'asking'; source: 'ebay';
  asOf: string; listings: { amount: number; url: string }[];
}
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** Titles help search but never establish identity. Require seller-provided
 * card/set/number/language/printing AND structured grader/grade descriptors. */
export function gradedComparableAmount(item: GradedItem, card: Card, variant: PrintVariant, graded: GradedCondition): number | null {
  if (item.conditionId !== '2750' || !item.buyingOptions?.includes('FIXED_PRICE')) return null;
  if (item.estimatedAvailabilities?.some(a => a.estimatedAvailabilityStatus === 'OUT_OF_STOCK')) return null;
  const aspect = (name: string) => item.localizedAspects?.find(a => normalize(a.name) === normalize(name))?.value ?? '';
  const descriptor = (name: string) => { const values = item.conditionDescriptors?.find(d => normalize(d.name) === normalize(name))?.values; return values?.length === 1 ? values[0]!.content : ''; };
  if (companyFromText(descriptor('Professional Grader')) !== graded.company || Number(descriptor('Grade')) !== graded.grade || !validGrade(graded.company, graded.grade)) return null;
  if (normalize(aspect('Card Name')) !== normalize(card.name) || normalize(aspect('Set')) !== normalize(card.set.name) || aspect('Language') !== 'English') return null;
  const number = aspect('Card Number').replace(/^#/, '').split('/')[0]!;
  if (normalize(number.replace(/^0+(?=\d)/, '')) !== normalize(card.number.replace(/^0+(?=\d)/, ''))) return null;
  const finish = normalize(aspect('Finish')), edition = normalize(aspect('Edition'));
  const expected = normalize(PRINTING_LABELS[variant] ?? '');
  if (!expected || ![normalize(aspect('Printing')), finish, edition + finish].includes(expected)) return null;
  // Non-1st-edition variants must explicitly exclude rare edition premiums.
  if (!variant.startsWith('1stEdition') && /(?:1st|first)[ -]?edition|shadowless|error|misprint/i.test([item.title, aspect('Features'), edition].join(' '))) return null;
  const description = [item.title, aspect('Features'), descriptor('Grade')].join(' ');
  const designation = /black label/i.test(description) ? 'Black Label' : /pristine/i.test(description) ? 'Pristine' : /gem[ -]?(mint|mt)/i.test(description) ? 'Gem Mint' : /\b(OC|MC|ST|MK|PD)\b/.exec(description)?.[1] ?? null;
  if ((graded.designation ?? null) !== designation) return null;
  const amount = Number(item.price?.value);
  let url: URL;
  try { url = new URL(item.itemWebUrl ?? ''); } catch { return null; }
  if (url.protocol !== 'https:' || !['www.ebay.com', 'ebay.com'].includes(url.hostname) || !url.pathname.startsWith('/itm/')) return null;
  return item.price?.currency === 'USD' && Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** Optional official eBay Browse integration. No credential or no exact
 * comparable means unavailable; an ungraded aggregate is never substituted. */
export async function fetchGradedAskingSample(card: Card, variant: PrintVariant, graded: GradedCondition): Promise<GradedAskingSample | null> {
  const token = process.env.EBAY_APP_TOKEN;
  if (!token || !validGrade(graded.company, graded.grade)) return null;
  const headers = { Authorization: 'Bearer ' + token, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US', 'Accept-Language': 'en-US' };
  const request = async (path: string) => {
    const response = await fetch('https://api.ebay.com/buy/browse/v1/' + path, { headers, cache: 'no-store', signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error('Graded price source unavailable');
    return response.json();
  };
  try {
    const q = [card.name, card.set.name, card.number, PRINTING_LABELS[variant], graded.company, graded.grade, graded.designation].filter(v => v != null).join(' ');
    const json = await request('item_summary/search?' + new URLSearchParams({ q, category_ids: '183454', filter: 'buyingOptions:{FIXED_PRICE},conditionIds:{2750}', limit: '15' })) as { itemSummaries?: { itemId: string }[] };
    const listings: { amount: number; url: string }[] = [];
    const seen = new Set<string>();
    // Bounded parallel batches keep a slow provider from stalling a scan.
    const items = (json.itemSummaries ?? []).slice(0, 9);
    for (let i = 0; i < items.length; i += 3) {
      const batch = await Promise.allSettled(items.slice(i, i + 3).map(item => request('item/' + encodeURIComponent(item.itemId)) as Promise<GradedItem>));
      for (const result of batch) {
        if (result.status !== 'fulfilled') continue;
        const amount = gradedComparableAmount(result.value, card, variant, graded), url = result.value.itemWebUrl;
        if (amount && url && !seen.has(url)) { seen.add(url); listings.push({ amount, url }); }
      }
    }
    if (!listings.length) return null;
    const amounts = listings.map(l => l.amount).sort((a, b) => a - b);
    return { cardId: card.id, variant, graded, median: medianAmount(amounts), low: amounts[0]!, count: amounts.length,
      currency: 'USD', source: 'ebay', basis: 'asking', asOf: new Date().toISOString(), listings };
  } catch { return null; }
}
