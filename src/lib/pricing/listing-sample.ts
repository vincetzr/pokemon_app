export interface Listing { price: number | null; condition: string | null; printing: string | null; language?: string | null }

/** Filter the returned rows too: an ignored server filter must not mix prices. */
export function matchingAmounts(listings: Listing[], condition: string, printing: string, language: string): number[] {
  return listings.filter((l) => l.condition === condition && l.printing === printing && l.language === language)
    .map((l) => l.price)
    .filter((p): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0)
    .sort((a, b) => a - b);
}
export function medianAmount(sorted: number[]): number {
  if (!sorted.length) throw new Error('Cannot price an empty sample');
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
