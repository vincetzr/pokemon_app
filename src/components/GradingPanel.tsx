'use client';

import { useEffect, useRef, useState } from 'react';
import { COMPANIES, COMPANY_LABELS, EMPTY_OBSERVATIONS, STANDARDS, WEAR_LABELS, estimateCondition, parseSlab, soldSearchUrl, validCert, validGrade, verificationUrl, type ConditionObservations, type SlabRead, type Wear } from '@/lib/grading/rules';
import { readSlabPhoto } from '@/lib/grading/browser';
import type { RawAskingSample } from '@/lib/grading/condition-price';
import type { GradedAskingSample } from '@/lib/pricing/graded';
import { RAW_CONDITION_LABELS, type Card, type GradingCompany, type PrintVariant } from '@/lib/types';

const field = 'mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-ink-100';
const button = 'rounded-lg border border-ink-700 px-3 py-2 text-sm text-ink-200 hover:bg-ink-850 disabled:opacity-40';
const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
type Sample = RawAskingSample | GradedAskingSample;

export function GradingPanel({ frontPhoto, card, slabRead, throughHolder, frontUsable }: { frontPhoto: string; card: Card | null; slabRead?: SlabRead | null; throughHolder: boolean; frontUsable: boolean }) {
  const [mode, setMode] = useState<'raw' | 'slab'>(throughHolder || slabRead?.detected ? 'slab' : 'raw');
  const [observations, setObservations] = useState<ConditionObservations>({ ...EMPTY_OBSERVATIONS, frontUsable, throughHolder });
  const [back, setBack] = useState<string | null>(null);
  const [notes, setNotes] = useState('Add a clear photo of the bare card’s back, then review visible wear on both sides.');
  const [working, setWorking] = useState(false);
  const [read, setRead] = useState(slabRead ?? null);
  const [company, setCompany] = useState<GradingCompany | ''>(slabRead?.company ?? '');
  const [cert, setCert] = useState(slabRead?.certNumber ?? '');
  const [grade, setGrade] = useState(slabRead?.grade != null ? String(slabRead.grade) : '');
  const [designation, setDesignation] = useState(slabRead?.designation ?? '');
  const [labelConfirmed, setLabelConfirmed] = useState(false);
  const [variant, setVariant] = useState<PrintVariant | ''>(card?.variants.length === 1 ? card.variants[0]! : '');
  const [sample, setSample] = useState<Sample | null>(null);
  const [priceMessage, setPriceMessage] = useState('Confirm the card, printing and condition to request a matching price.');
  const workId = useRef(0);
  useEffect(() => () => { workId.current++; }, []);
  useEffect(() => { setVariant(card?.variants.length === 1 ? card.variants[0]! : ''); setSample(null); }, [card?.id]);
  const assessment = estimateCondition(observations);
  const usableGrade = company && grade && validGrade(company, Number(grade)) && !/authentic|altered/i.test(designation);
  const certLink = company && validCert(company, cert.trim()) ? verificationUrl(company, cert.trim()) : null;
  const condition = mode === 'raw' ? assessment.raw ? { kind: 'raw' as const, condition: assessment.raw } : null
    : labelConfirmed && usableGrade ? { kind: 'graded' as const, company: company as GradingCompany, grade: Number(grade), designation: designation || null } : null;
  const conditionKey = JSON.stringify(condition);
  useEffect(() => {
    setSample(null);
    if (!card || !variant || !condition) { setPriceMessage('Confirm the card, printing and reviewed condition to see a matching price.'); return; }
    const controller = new AbortController();
    setPriceMessage('Finding matching condition offers…');
    const timer = setTimeout(() => { controller.abort(); setPriceMessage('The condition price request timed out. Change the condition or printing to retry.'); }, 50_000);
    fetch('/api/condition-price', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cardId: card.id, variant, condition }), signal: controller.signal })
      .then(r => r.json()).then(body => {
        if (controller.signal.aborted) return;
        setSample(body.sample ?? null); setPriceMessage(body.reason ?? body.error ?? '');
      }).catch(() => { if (!controller.signal.aborted) setPriceMessage('The price source is unavailable. No raw average or grade multiplier is substituted.'); })
      .finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); };
  }, [card?.id, variant, conditionKey]);

  async function addBack(file: File) {
    const current = ++workId.current; setWorking(true); setSample(null); setObservations(o => ({ ...o, confirmed: false, backUsable: false }));
    try {
      const image = await fileDataUrl(file); if (current !== workId.current) return; setBack(image);
      const res = await fetch('/api/assess-condition', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ front: frontPhoto, back: image, throughHolder }), signal: AbortSignal.timeout(40_000) });
      const body = await res.json(); if (current !== workId.current) return;
      if (!res.ok) throw new Error(body.error);
      setObservations(body.observations); setNotes(body.notes);
    } catch (e) { if (current === workId.current) setNotes(e instanceof Error ? e.message : 'Back photo could not be assessed.'); }
    finally { if (current === workId.current) setWorking(false); }
  }
  async function scanLabel(file: File) {
    const current = ++workId.current; setWorking(true); setLabelConfirmed(false); setSample(null);
    try {
      const next = await readSlabPhoto(file, company || null, text => { if (current === workId.current) setNotes(text); });
      if (current !== workId.current) return;
      setRead(next); setCompany(next.company ?? company); setCert(next.certNumber ?? ''); setGrade(next.grade != null ? String(next.grade) : ''); setDesignation(next.designation ?? '');
      setNotes(next.barcodes.length ? 'Decoded code available. Review the printed label and compare the official record.' : 'No code could be decoded. Use a closer, sharp label or barcode photo, or type the label.');
    } catch { if (current === workId.current) setNotes('The photo could not be read. Enter the label details below.'); }
    finally { if (current === workId.current) setWorking(false); }
  }
  const editSlab = () => { setLabelConfirmed(false); setSample(null); };
  const search = card && variant && company && usableGrade ? soldSearchUrl({ name: card.name, setName: card.set.name, number: card.number, language: 'English' }, variant, { company, grade: Number(grade), designation }) : null;

  return <section className="rounded-xl border border-ink-700 bg-ink-900/60 p-4">
    <h2 className="text-base font-semibold text-ink-100">Condition &amp; slab grading</h2>
    <div className="mt-3 flex gap-2" role="group" aria-label="Condition mode">
      <button className={button} aria-pressed={mode === 'raw'} onClick={() => { workId.current++; setWorking(false); setMode('raw'); setLabelConfirmed(false); }}>Raw card</button>
      <button className={button} aria-pressed={mode === 'slab'} onClick={() => { workId.current++; setWorking(false); setMode('slab'); setSample(null); }}>Slab / barcode</button>
    </div>
    {mode === 'raw' ? <div className="mt-4 space-y-3">
      <p className="text-xs leading-relaxed text-ink-300">A photo can screen visible wear. PSA, Beckett, CGC and PCG assign official grades after inspection. A raw card keeps a raw condition price.</p>
      {throughHolder && <p className="text-xs text-warn-400">This scan includes a holder. Scan the bare card separately for a condition estimate, or use the slab label.</p>}
      <label className={button + ' inline-block cursor-pointer'}>Add back photo<input className="sr-only" type="file" accept="image/*" capture="environment" disabled={working || throughHolder} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void addBack(f); }} /></label>
      {back && <img src={back} alt="Back photo for condition review" className="h-36 max-w-full rounded-lg object-contain" />}
      <p className="text-xs text-ink-400" role="status">{working ? 'Inspecting the back photo…' : notes}</p>
      {(['corners', 'edges', 'surface'] as const).map(part => <label key={part} className="block text-xs capitalize text-ink-300">{part} · both sides<select className={field} value={observations[part]} onChange={e => setObservations(o => ({ ...o, [part]: e.target.value as Wear, confirmed: false }))}>{Object.entries(WEAR_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>)}
      <label className="block text-xs text-ink-300">Creases, dents or structural damage<select className={field} value={observations.creases} onChange={e => setObservations(o => ({ ...o, creases: e.target.value as ConditionObservations['creases'], confirmed: false }))}><option value="unknown">Not inspected</option><option value="none">None visible on either side</option><option value="minor">Minor crease or dent</option><option value="major">Major crease, dent, water damage or tearing</option></select></label>
      <label className="flex items-start gap-2 text-xs text-ink-300"><input type="checkbox" checked={observations.confirmed} disabled={!observations.frontUsable || !observations.backUsable || throughHolder} onChange={e => setObservations(o => ({ ...o, confirmed: e.target.checked }))} />I inspected both sides and confirm these observations.</label>
      <p className="text-sm font-semibold text-bolt-400">{assessment.raw ? 'Estimated raw condition: ' + RAW_CONDITION_LABELS[assessment.raw] : 'Condition estimate needs review'}</p>
      {assessment.gradeRanges.length > 0 && <div className="grid grid-cols-2 gap-2">{assessment.gradeRanges.map(range => <a key={range.company} href={STANDARDS[range.company]} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-ink-800 p-2 text-xs text-ink-300">{COMPANY_LABELS[range.company]} screening range<br /><span className="text-base text-ink-100">{range.low}–{range.high}</span>{assessment.provisional ? ' · provisional' : ' · estimate'}</a>)}</div>}
      <p className="text-xs leading-relaxed text-ink-400">{assessment.reasons.join(' ')}</p>
    </div> : <div className="mt-4 space-y-3">
      <p className="text-xs leading-relaxed text-ink-300">Photograph the label or reverse barcode closely. QR, Code 128, Code 39, ITF, Data Matrix and PDF417 are supported. A decoded code does not authenticate the holder.</p>
      <label className={button + ' inline-block cursor-pointer'}>Scan label / barcode<input className="sr-only" type="file" accept="image/*" capture="environment" disabled={working} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void scanLabel(f); }} /></label>
      <p className="text-xs text-ink-400" role="status">{working ? notes : read?.barcodes.length ? 'Decoded: ' + read.barcodes.map(b => b.format + ' · ' + b.text).join('; ') : notes}</p>
      {read?.conflicts.map(c => <p key={c} className="text-xs text-warn-400">{c}</p>)}
      <label className="block text-xs text-ink-300">Grading company<select className={field} value={company} onChange={e => { editSlab(); const chosen = e.target.value as GradingCompany | ''; setCompany(chosen); const parsed = parseSlab(read?.labelText ?? '', read?.barcodes ?? [], chosen || null); setGrade(parsed.grade != null ? String(parsed.grade) : ''); setCert(parsed.certNumber ?? ''); setDesignation(parsed.designation ?? ''); }}><option value="">Choose the company on the label</option>{COMPANIES.map(c => <option key={c} value={c}>{COMPANY_LABELS[c]}</option>)}</select></label>
      <label className="block text-xs text-ink-300">Certificate number · keep leading zeros<input className={field} value={cert} onChange={e => { editSlab(); setCert(e.target.value); }} autoComplete="off" /></label>
      <label className="block text-xs text-ink-300">Overall printed grade · exclude autograph and subgrades<select className={field} value={grade} onChange={e => { editSlab(); setGrade(e.target.value); }}><option value="">Not readable / authentication only</option>{Array.from({ length: 19 }, (_, i) => 1 + i / 2).filter(g => company && validGrade(company, g)).map(g => <option key={g} value={g}>{g}</option>)}</select></label>
      <label className="block text-xs text-ink-300">Printed designation / qualifier<select className={field} value={designation} onChange={e => { editSlab(); setDesignation(e.target.value); }}><option value="">Standard numeric grade</option>{['Gem Mint', 'Pristine', 'Black Label', 'OC', 'MC', 'ST', 'MK', 'PD', 'Authentic only', 'Authentic Altered'].map(d => <option key={d} value={d}>{d}</option>)}</select></label>
      {certLink && <a className="block text-sm text-bolt-400" href={certLink} target="_blank" rel="noopener noreferrer">Open {company} official certificate lookup ↗</a>}
      {company === 'PCG' && certLink && !/^\d{9}$/.test(cert.trim()) && <p className="text-xs text-ink-400">Copy {cert.trim()} into PCG’s Cert Lookup &amp; Pop Search.</p>}
      {company === 'BGS' && <p className="text-xs text-ink-400">Beckett’s lookup may be temporarily unavailable during its site maintenance.</p>}
      <label className="flex items-start gap-2 text-xs text-ink-300"><input type="checkbox" checked={labelConfirmed} disabled={!usableGrade || !certLink || working} onChange={e => setLabelConfirmed(e.target.checked)} />I checked the company, overall grade, designation and certificate against the label. This is a label confirmation, not authentication.</label>
      {read?.labelText && <details className="text-xs text-ink-400"><summary>Text read from the label</summary><pre className="mt-2 whitespace-pre-wrap break-words">{read.labelText}</pre></details>}
    </div>}
    <div className="mt-4 border-t border-ink-700 pt-3">
      {card && card.variants.length > 1 && <label className="block text-xs text-ink-300">Printing for this price<select className={field} value={variant} onChange={e => setVariant(e.target.value as PrintVariant)}><option value="">Choose the actual printing</option>{card.variants.map(v => <option key={v} value={v}>{v.replace(/([A-Z])/g, ' $1')}</option>)}</select></label>}
      <p className="mt-3 text-xs uppercase tracking-wide text-ink-400">Price for the reviewed condition</p>
      {sample ? <div className="mt-1"><p className="font-mono text-2xl text-ink-100">{money(sample.median)}</p><p className="mt-1 text-xs text-ink-300">Sample median of {sample.count} asking offers · lowest {money(sample.low)} · {sample.asOf.slice(0, 10)} · USD. Shipping and tax excluded. Asking offers are not completed sales.</p>{'sourceUrl' in sample ? <a href={sample.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block text-xs text-bolt-400">View TCGplayer product ↗</a> : sample.listings.map((l, i) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="mt-2 block text-xs text-bolt-400">Comparable offer {i + 1}: {money(l.amount)} ↗</a>)}</div> : <p className="mt-2 text-xs leading-relaxed text-ink-300" role="status">{priceMessage}</p>}
      {search && <a href={search} target="_blank" rel="noopener noreferrer" className="mt-3 block text-sm text-bolt-400">Review sold comparables for {company} {grade} {designation} ↗</a>}
    </div>
  </section>;
}
async function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Photo could not be opened.')); reader.readAsDataURL(file); });
}
