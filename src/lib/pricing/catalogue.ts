import type { Card } from '../types';

export interface TcgCsvGroup { groupId: number; name: string; abbreviation?: string | null; publishedOn?: string }
export interface TcgCsvProduct { productId: number; name: string; extendedData?: { name: string; value: string }[] }

function setName(name: string): string {
  const s = name.toLowerCase().replace(/^(?:swsh|sv|sm|xy|bw|dp|hgss|ex)\d*[a-z]?\s*:\s*/i, '')
    .replace(/base set/g, 'base').replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
  return ['scarletandviolet151', 'scarletviolet151'].includes(s) ? '151' : s;
}
export function matchGroup(card: Card, groups: TcgCsvGroup[]): number | null {
  const exact = groups.filter((g) => setName(g.name) === setName(card.set.name));
  if (exact.length === 1) return exact[0]!.groupId;
  // The catalogue creation date is not a unique set identity.
  const date = card.set.releaseDate.replace(/\//g, '-').slice(0, 10);
  const dated = exact.filter((g) => g.publishedOn?.slice(0, 10) === date);
  return dated.length === 1 ? dated[0]!.groupId : null;
}
const nameKey = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const numberKey = (s: string) => s.trim().toUpperCase().replace(/^([A-Z]*)0+(?=\d)/, '$1');
export function matchProduct(card: Card, products: TcgCsvProduct[]): number | null {
  const exact = products.filter((p) => {
    const field = p.extendedData?.find((e) => e.name === 'Number')?.value;
    if (!field) return false;
    // Some sets append the collector number to the catalogue name. Remove
    // only that exact suffix, never descriptive printing/edition qualifiers.
    const suffix = p.name.match(/\s+(?:-\s*|\()([A-Z]*\d+\/[A-Z]*\d+)\)?$/i);
    const productName = suffix && suffix[1]!.toUpperCase() === field.toUpperCase()
      ? p.name.slice(0, suffix.index) : p.name;
    if (nameKey(productName) !== nameKey(card.name)) return false;
    const [number, total] = field.split('/');
    return numberKey(number!) === numberKey(card.number) && (!total || numberKey(total) === String(card.set.printedTotal));
  });
  return exact.length === 1 ? exact[0]!.productId : null;
}
