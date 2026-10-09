'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { CameraCapture, type CaptureResult } from '@/components/CameraCapture';
import { AuthReportCard } from '@/components/AuthReportCard';
import { ConditionPrices } from '@/components/ConditionPrices';
import { GradingPanel } from '@/components/GradingPanel';
import type { ConditionPricing } from '@/lib/pricing/sources/tcgplayer-listings';
import type { Card, IdentifyCandidate, ScanResult } from '@/lib/types';

interface ScanResponse extends ScanResult {
  quality: { sharpness: number; glareFraction: number; warnings: string[] };
  detection: { method: string; confidence: number };
  conditions: ConditionPricing | null;
}

export default function ScanPage() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'raw' | 'slab'>('raw');
  const [photo, setPhoto] = useState<string | null>(null);

  const onCapture = useCallback(async (capture: CaptureResult) => {
    setBusy(true);
    setError(null);
    setResult(null);
    setPhoto(capture.dataUrl);

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: capture.dataUrl, guide: capture.guide, mode }),
        signal: AbortSignal.timeout(115_000),
      });

      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'The scan failed.');
        return;
      }
      setResult(body as ScanResponse);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }, [mode]);

  return (
    <div className="px-4 pt-6">
      <h1 className="mb-4 text-xl font-semibold tracking-tight">Scan a card</h1>

      {!result && <><div className="mb-3 flex gap-2" role="group" aria-label="Scan subject">{(['raw', 'slab'] as const).map(m => <button key={m} aria-pressed={mode === m} disabled={busy} onClick={() => setMode(m)} className="rounded-lg border border-ink-700 px-3 py-2 text-sm text-ink-200">{m === 'raw' ? 'Raw card' : 'Graded slab'}</button>)}</div><CameraCapture onCapture={onCapture} busy={busy} subject={mode} /></>}

      {error && (
        <div className="mt-4 rounded-lg border border-bad-500/40 bg-bad-500/10 p-3 text-[13px] text-bad-400">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="flex gap-3">
            {result.imageRef && (
              <img
                src={result.imageRef}
                alt="The card you scanned"
                className="h-32 w-auto rounded-lg border border-ink-800"
              />
            )}
            <div className="min-w-0 flex-1">
              {result.card ? (
                <>
                  <h2 className="text-base font-semibold text-ink-100">{result.card.name}</h2>
                  <p className="mt-0.5 text-[13px] text-ink-300">
                    {result.card.set.name} · {result.card.number}/{result.card.set.printedTotal}
                  </p>
                  {result.card.rarity && (
                    <p className="mt-0.5 text-[12px] text-ink-400">{result.card.rarity}</p>
                  )}
                  <Link
                    href={`/card/${result.card.id}`}
                    className="mt-2 inline-block rounded-lg bg-bolt-500 px-3 py-1.5 text-[13px] font-semibold text-ink-950 hover:bg-bolt-400"
                  >
                    Prices &amp; history
                  </Link>
                </>
              ) : (
                <p className="text-[13px] text-ink-300">Card not identified — pick from the list below.</p>
              )}
            </div>
          </div>

          {result.pricing?.headline && (
            <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-4">
              <div className="text-[11px] uppercase tracking-wide text-ink-400">
                Market reference · condition unspecified
              </div>
              <div className="mt-1 font-mono text-2xl font-semibold text-ink-100">
                {formatMoney(result.pricing.headline.price)}
              </div>
              <div className="mt-1 text-[12px] text-ink-400">
                {result.pricing.headline.source === 'tcgplayer' ? 'TCGplayer' : 'Cardmarket'} ·{' '}
                {result.pricing.headline.variant} · {result.pricing.headline.asOf}
              </div>
            </div>
          )}

          {result.conditions && <ConditionPrices pricing={result.conditions} />}
          {photo && <GradingPanel key={result.scanId} frontPhoto={photo} card={result.card} slabRead={result.slab} throughHolder={Boolean(result.throughHolder)} frontUsable={!result.quality.warnings.length} />}

          {result.identify.candidates.length > 0 && !result.identify.autoSelected && (
            <CandidateList candidates={result.identify.candidates} onSelect={async card => {
              setBusy(true); setError(null);
              try {
                const response = await fetch('/api/cards/' + encodeURIComponent(card.id));
                const body = await response.json();
                if (!response.ok) throw new Error(body.error ?? 'Card could not be loaded.');
                setResult(previous => previous ? { ...previous, card: body.card, pricing: previous.throughHolder ? null : body.pricing, conditions: null, auth: null, identify: { ...previous.identify, autoSelected: true, warnings: [...previous.identify.warnings, 'Card identity was confirmed manually. The earlier authenticity report was cleared.'] } } : previous);
              } catch (e) { setError(e instanceof Error ? e.message : 'Card could not be loaded.'); }
              finally { setBusy(false); }
            }} />
          )}

          {result.identify.warnings.length > 0 && (
            <ul className="space-y-1.5 rounded-lg border border-ink-800 bg-ink-900/40 p-3">
              {result.identify.warnings.map((w) => (
                <li key={w} className="text-[12px] leading-relaxed text-ink-400">
                  {w}
                </li>
              ))}
            </ul>
          )}

          {result.auth && <AuthReportCard report={result.auth} />}

          <button
            type="button"
            onClick={() => setResult(null)}
            className="w-full rounded-xl border border-ink-700 px-4 py-3 text-sm font-medium text-ink-200 hover:bg-ink-850"
          >
            Scan another card
          </button>
        </div>
      )}
    </div>
  );
}

function CandidateList({ candidates, onSelect }: { candidates: IdentifyCandidate[]; onSelect: (card: Card) => void }) {
  return (
    <div className="rounded-xl border border-warn-500/40 bg-warn-500/10 p-4">
      <h3 className="text-[13px] font-semibold text-warn-400">Which printing is it?</h3>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-300">
        These matched closely. Prices differ a lot between printings, so pick the right one.
      </p>
      <ul className="mt-3 space-y-2">
        {candidates.slice(0, 5).map((c) => (
          <li key={c.card.id}>
            <button type="button"
              onClick={() => onSelect(c.card)}
              className="flex w-full items-center gap-3 rounded-lg border border-ink-800 bg-ink-950/50 p-2.5 text-left hover:bg-ink-850"
            >
              <CardThumb card={c.card} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-ink-100">{c.card.name}</div>
                <div className="truncate text-[12px] text-ink-400">
                  {c.card.set.name} · {c.card.number}/{c.card.set.printedTotal}
                </div>
              </div>
              <span className="shrink-0 font-mono text-[11px] text-ink-400">
                Match score {Math.round(c.confidence * 100)}/100
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CardThumb({ card }: { card: Card }) {
  return (
    <Image
      src={card.images.small}
      alt=""
      width={36}
      height={50}
      className="h-[50px] w-9 shrink-0 rounded object-cover"
      unoptimized
    />
  );
}

function formatMoney(m: { amount: number; currency: string }): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: m.currency,
    maximumFractionDigits: m.amount >= 100 ? 0 : 2,
  }).format(m.amount);
}
