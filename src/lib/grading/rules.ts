import type { GradingCompany, RawCondition } from '../types';

export const COMPANIES: readonly GradingCompany[] = ['PSA', 'BGS', 'CGC', 'PCG'];
export const COMPANY_LABELS = { PSA: 'PSA', BGS: 'Beckett (BGS)', CGC: 'CGC Cards', PCG: 'Premier Card Grading (PCG)' } as const;
const COMPANY_MARKERS: Record<GradingCompany, RegExp> = { PSA: /\bPSA\b|professional sports authenticator/i, BGS: /\bBGS\b|\bbeckett\b/i, CGC: /\bCGC\b|certified guaranty company/i, PCG: /\bPCG\b|premier card grading/i };
export const STANDARDS = {
  PSA: 'https://www.psacard.com/gradingstandards',
  BGS: 'https://www.beckett.com/grading/scale',
  CGC: 'https://www.cgccards.com/card-grading/grading-scale/',
  PCG: 'https://premiercardgrading.com/pages/grading-standards',
} as const;
export interface BarcodeRead { text: string; format: string }
export interface SlabRead {
  detected: boolean;
  company: GradingCompany | null;
  grade: number | null;
  designation: string | null;
  certNumber: string | null;
  verificationUrl: string | null;
  labelText: string;
  barcodes: BarcodeRead[];
  conflicts: string[];
  needsReview: true;
}

export function companyFromText(text: string): GradingCompany | null {
  const found = COMPANIES.filter(c => COMPANY_MARKERS[c].test(text));
  return found.length === 1 ? found[0]! : null;
}

export function validGrade(company: GradingCompany, grade: number): boolean {
  return Number.isFinite(grade) && grade >= 1 && grade <= 10 && Number.isInteger(grade * 2) && !(company === 'PSA' && grade === 9.5);
}
export function validCert(company: GradingCompany, cert: string): boolean {
  return company === 'CGC' ? /^\d{10}$/.test(cert) : company === 'PCG' ? /^[A-Z0-9-]{6,24}$/i.test(cert) : /^\d{6,12}$/.test(cert);
}
export function verificationUrl(company: GradingCompany, cert: string): string | null {
  if (!validCert(company, cert)) return null;
  if (company === 'PSA') return 'https://www.psacard.com/cert/' + cert;
  if (company === 'CGC') return 'https://www.cgccards.com/certlookup/' + cert + '/';
  if (company === 'BGS') return 'https://www.beckett.com/grading/card-lookup?flag=1&item_id=' + cert;
  // PCG's current official site links to pcgpopreport.com; verified nine-digit
  // certificate records use /report/{cert}. Other formats use its search form.
  return /^\d{9}$/.test(cert) ? 'https://pcgpopreport.com/report/' + cert : 'https://pcgpopreport.com/';
}

export function certificateFromBarcode(read: BarcodeRead, hint?: GradingCompany | null): { company: GradingCompany; cert: string } | null {
  const text = read.text.trim();
  if (/^https?:/i.test(text)) {
    let url: URL;
    try { url = new URL(text); } catch { return null; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    let company: GradingCompany | null = null, cert: string | undefined;
    if (['psacard.com', 'www.psacard.com'].includes(host)) {
      company = 'PSA'; cert = /^\/cert\/(\d{6,12})(?:\/|$)/i.exec(url.pathname)?.[1];
    } else if (['cgccards.com', 'www.cgccards.com'].includes(host)) {
      company = 'CGC'; cert = /^\/certlookup\/(\d{10})(?:\/|$)/i.exec(url.pathname)?.[1];
    } else if (['beckett.com', 'www.beckett.com'].includes(host) && /^\/grading\/card-lookup\/?$/i.test(url.pathname) && url.searchParams.get('flag') === '1') {
      company = 'BGS'; cert = url.searchParams.get('item_id') ?? undefined;
    } else if (['pcgpopreport.com', 'www.pcgpopreport.com', 'pop.premiercardgrading.com'].includes(host)) {
      company = 'PCG'; cert = /^\/report\/(\d{9})(?:\/|$)/i.exec(url.pathname)?.[1];
    }
    return company && cert && validCert(company, cert) ? { company, cert } : null;
  }
  // Retail UPC/EAN codes identify a product, not a grader's certificate.
  if (/EAN|UPC/i.test(read.format) || !hint || !validCert(hint, text)) return null;
  return { company: hint, cert: text };
}

function labelCerts(text: string, company: GradingCompany | null): string[] {
  if (!company) return [];
  const explicit = [...text.matchAll(/(?:cert(?:ification)?(?:\s*(?:no|number))?|serial(?:\s*(?:no|number))?)\s*[#:.\-]?\s*([A-Z0-9-]{6,24})/gi)]
    .map(m => m[1]!).filter(c => validCert(company, c));
  if (explicit.length) return [...new Set(explicit)];
  return [...new Set(text.split('\n').map(s => s.trim()).filter(s => /^\d+$/.test(s) && validCert(company, s)))];
}

export function parseSlab(labelText: string, barcodes: BarcodeRead[] = [], hint?: GradingCompany | null): SlabRead {
  const conflicts: string[] = [];
  const labelCompanies = COMPANIES.filter(c => COMPANY_MARKERS[c].test(labelText));
  if (labelCompanies.length > 1) conflicts.push('More than one grading company appears on the label. Check the original label.');
  const labelCompany = companyFromText(labelText);
  const reads = barcodes.slice(0, 12).filter(b => b.text.length <= 500);
  const certReads = reads.map(b => certificateFromBarcode(b, labelCompany ?? hint)).filter((r): r is NonNullable<typeof r> => r !== null);
  const companies = [...new Set([...labelCompanies, hint, ...certReads.map(r => r.company)].filter((c): c is GradingCompany => Boolean(c)))];
  const unsupportedBeckett = /\bBCCG\b|\bBVG\b|beckett (?:collectors club|vintage)/i.test(labelText);
  if (unsupportedBeckett) conflicts.push('BVG and BCCG use different Beckett services. They cannot be treated as BGS grades. Check the appropriate official lookup manually.');
  const company = companies.length === 1 && !unsupportedBeckett ? companies[0]! : null;
  if (companies.length > 1) conflicts.push('The label, barcode or selected grader disagree. Rescan and check the label.');
  const certs = [...new Set([...labelCerts(labelText, company), ...certReads.filter(r => r.company === company).map(r => r.cert)])];
  if (certs.length > 1) conflicts.push('More than one certificate number was read. Check the original label.');
  const certNumber = certs.length === 1 ? certs[0]! : null;
  if (reads.some(b => /^https?:/i.test(b.text.trim()) && !certificateFromBarcode(b))) conflicts.push('An unrecognised QR link was ignored. Only official certificate links can be opened.');
  const lines = labelText.split('\n').map(s => s.trim()).filter(Boolean);
  const grades: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/cent(?:er|re)ing|corners?|edges?|surface|autograph|\bauto\b|cert|serial/i.test(line)) continue;
    const match = /(?:overall|final|grade|gem[ -]?(?:mint|mt)|pristine|\bmint\b|\bnm[ -]?(?:mt|mint)\b|\bex[ -]?mt\b|\bvg[ -]?ex\b)\s*[:\-]?\s*(10|[1-9](?:\.5)?)(?![\d.])/i.exec(line)
      ?? /^(10|[1-9](?:\.5)?)\s+(?:gem|mint|pristine|near|excellent|good|fair|poor|worn|damaged)\b/i.exec(line)
      ?? (/^(?:overall|final|grade|gem[ -]?(?:mint|mt)|mint|pristine)$/i.test(line) ? /^(10|[1-9](?:\.5)?)$/.exec(lines[i + 1] ?? '') : null);
    if (match) grades.push(Number(match[1]));
    else if (/^(10|[1-9](?:\.5)?)$/.test(line) && /^(gem[ -]?(mint|mt)|mint|pristine|nm[ -]?(mt|mint))$/i.test(lines[i + 1] ?? '')) grades.push(Number(line));
  }
  const uniqueGrades = [...new Set(grades)];
  let grade = uniqueGrades.length === 1 && company && validGrade(company, uniqueGrades[0]!) ? uniqueGrades[0]! : null;
  if (uniqueGrades.length > 1 || (uniqueGrades.length === 1 && company && !validGrade(company, uniqueGrades[0]!))) conflicts.push('The overall grade could not be read consistently. Do not use a subgrade or autograph grade.');
  const authenticOnly = /\bauthentic(?:ation)?(?:[ -]only)?\b|\baltered\b/i.test(labelText);
  if (authenticOnly) grade = null;
  const designation = authenticOnly ? (/\baltered\b/i.test(labelText) ? 'Authentic Altered' : 'Authentic only')
    : /black label/i.test(labelText) ? 'Black Label' : /pristine/i.test(labelText) ? 'Pristine'
    : /gem[ -]?(mint|mt)/i.test(labelText) ? 'Gem Mint' : /\b(OC|MC|ST|MK|PD)\b/.exec(labelText)?.[1] ?? null;
  return { detected: Boolean(labelCompanies.length || certReads.length || hint), company, grade, designation, certNumber,
    verificationUrl: company && certNumber && !conflicts.length ? verificationUrl(company, certNumber) : null,
    labelText, barcodes: reads, conflicts, needsReview: true };
}

export type Wear = 'unknown' | 'none' | 'minor' | 'moderate' | 'heavy' | 'severe';
export const WEAR_LABELS: Record<Wear, string> = { unknown: 'Not inspected', none: 'No visible wear', minor: 'Minor wear', moderate: 'Moderate wear', heavy: 'Heavy wear', severe: 'Severe damage' };
export interface ConditionObservations {
  corners: Wear; edges: Wear; surface: Wear;
  creases: 'unknown' | 'none' | 'minor' | 'major';
  frontUsable: boolean; backUsable: boolean; throughHolder: boolean; confirmed: boolean;
  frontCentering?: number | null; backCentering?: number | null;
}
export const EMPTY_OBSERVATIONS: ConditionObservations = { corners: 'unknown', edges: 'unknown', surface: 'unknown', creases: 'unknown', frontUsable: false, backUsable: false, throughHolder: false, confirmed: false };
export interface ConditionAssessment {
  raw: RawCondition | null;
  provisional: boolean;
  gradeRanges: { company: GradingCompany; low: number; high: number }[];
  reasons: string[];
}
const SEVERITY: Record<Wear, number> = { unknown: 0, none: 0, minor: 1, moderate: 2, heavy: 3, severe: 4 };
const RAW: RawCondition[] = ['NM', 'LP', 'MP', 'HP', 'DMG'];
export function estimateCondition(o: ConditionObservations): ConditionAssessment {
  const reasons: string[] = [];
  if (!o.frontUsable || !o.backUsable) reasons.push('Clear front and back images of the bare card are required.');
  if (o.throughHolder) reasons.push('Plastic hides wear. Use the printed slab grade; do not estimate a raw grade through the holder.');
  if ([o.corners, o.edges, o.surface].includes('unknown') || o.creases === 'unknown') reasons.push('Inspect corners, edges, surface and creases on both sides before confirming.');
  if (!o.confirmed) reasons.push('Review and confirm the visible wear before selecting a condition price.');
  const provisional = reasons.length > 0;
  const severity = Math.max(SEVERITY[o.corners], SEVERITY[o.edges], SEVERITY[o.surface], o.creases === 'major' ? 4 : o.creases === 'minor' ? 2 : 0);
  if (o.throughHolder || !o.frontUsable || !o.backUsable) return { raw: null, provisional: true, gradeRanges: [], reasons };
  const lowBands: Record<GradingCompany, number[]> = { PSA: [8, 6, 4, 2, 1], BGS: [8, 6, 4, 2, 1], CGC: [8, 6, 4, 2, 1], PCG: [8, 6, 4, 2, 1] };
  const highBands: Record<GradingCompany, number[]> = { PSA: [9, 8, 6, 4, 2], BGS: [9.5, 8.5, 6.5, 4.5, 2.5], CGC: [9.5, 8.5, 6.5, 4.5, 2.5], PCG: [9.5, 8.5, 6, 4, 2] };
  const unknown = [o.corners, o.edges, o.surface].includes('unknown') || o.creases === 'unknown';
  const gradeRanges = COMPANIES.map(company => {
    let high = highBands[company][severity]!;
    // Conservative screening limits, not a grader's proprietary formula. A
    // measured centering gate never improves the wear estimate or raw price.
    const front = o.frontCentering, back = o.backCentering;
    if (front != null && Number.isFinite(front) && front >= 50 && front <= 100) {
      const limits = company === 'PCG' ? [[55, 9.5], [60, 9], [65, 8], [70, 7], [80, 5], [85, 3], [90, 2]] : [[55, 9.5], [60, 9], [65, 8], [70, 7], [80, 6], [85, 5], [90, 3]];
      high = Math.min(high, limits.find(b => front <= b[0]!)?.[1] ?? 2);
    }
    if (back != null && Number.isFinite(back) && back > 90) high = Math.min(high, 3);
    return { company, low: unknown ? 1 : Math.min(lowBands[company][severity]!, Math.max(1, high - 1)), high };
  });
  reasons.push('Broad screening ranges use visible wear and optional centering. They are not calibrated PSA, Beckett, CGC or PCG predictions; hidden dents, restoration and grader judgment can change the result.');
  reasons.push('Gem Mint 10, Pristine and Black Label are not predicted from phone photos. A raw condition does not convert into an official slab grade.');
  return { raw: provisional ? null : RAW[severity]!, provisional, gradeRanges, reasons };
}

export function soldSearchUrl(card: { name: string; setName: string; number: string; language?: string }, variant: string, slab: { company: GradingCompany; grade: number; designation?: string | null }): string {
  const query = ['Pokémon', card.name, card.setName, '#' + card.number, card.language ?? 'English', variant, slab.company, String(slab.grade), slab.designation ?? ''].join(' ');
  return 'https://www.ebay.com/sch/i.html?' + new URLSearchParams({ _nkw: query, LH_Sold: '1', LH_Complete: '1' });
}
