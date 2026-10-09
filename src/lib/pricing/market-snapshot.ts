import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RawCard } from '../tcg-api';
import type { PriceQuote, PrintVariant } from '../types';

export interface MarketSnapshot {
  schema: number;
  asOf: string;
  cards: Record<string, { name: string; number: string; setName: string; language: string; quotes:
    { variant: string; amount: number; currency: string; basis: string; condition: string }[] }>;
}
const VARIANTS: Record<string, PrintVariant> = {
  Normal: 'normal', Holofoil: 'holofoil', 'Reverse Holofoil': 'reverseHolofoil',
  '1st Edition': '1stEdition', '1st Edition Normal': '1stEdition', '1st Edition Holofoil': '1stEditionHolofoil',
  Unlimited: 'unlimited', 'Unlimited Normal': 'unlimited', 'Unlimited Holofoil': 'unlimitedHolofoil',
};
/** Null means there is no verified mapping; an empty array means no usable quote. */
export function snapshotQuotes(raw: RawCard, data: MarketSnapshot | null, now = Date.now()): PriceQuote[] | null {
  const time = Date.parse(data?.asOf ?? '');
  if (!data || data.schema !== 1 || !Number.isFinite(time) || time > now + 300_000) return null;
  const entry = data.cards?.[raw.id];
  if (!entry || entry.name !== raw.name || entry.number !== raw.number || entry.setName !== raw.set.name || entry.language !== 'English') return null;
  return entry.quotes.filter(q => VARIANTS[q.variant] && q.currency === 'USD' && q.basis === 'market' &&
    q.condition === 'unspecified' && Number.isFinite(q.amount) && q.amount > 0).map(q => ({
    cardId: raw.id, variant: VARIANTS[q.variant]!, condition: { kind: 'ungraded' },
    price: { amount: q.amount, currency: 'USD' }, source: 'tcgplayer', provenance: 'observed',
    basis: 'market', asOf: data.asOf.slice(0, 10),
  }));
}
export function readMarketSnapshot(): MarketSnapshot | null {
  try { return JSON.parse(readFileSync(resolve(process.cwd(), 'docs/prices/latest.json'), 'utf8')); }
  catch { return null; }
}
