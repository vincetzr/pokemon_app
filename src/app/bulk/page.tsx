'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { CameraCapture, type CaptureResult } from '@/components/CameraCapture';
import type { Card, Money, ScanResult } from '@/lib/types';

/**
 * Bulk scanning: work through a pile and find what's worth attention.
 *
 * Two deliberate choices. Vision is skipped (`fast: true`) because a pile means
 * dozens of scans and OCR alone identifies most cards — the user can re-scan
 * anything that missed. And cards that could not be priced sort into their own
 * group rather than to the bottom as zero, because "unknown" and "worthless"
 * are different answers and collapsing them would bury a valuable card that
 * simply had no quote that day.
 */

interface Entry {
  scanId: string;
  card: Card | null;
  value: Money | null;
  thumb: string | null;
  unidentified: boolean;
}

const DEFAULT_THRESHOLD = 5;

export default function BulkPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [error, setError] = useState<string | null>(null);

  const onCapture = useCallback(async (capture: CaptureResult) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: capture.dataUrl, guide: capture.guide, fast: true }),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(body.error ?? 'That scan failed. Try again.');
        return;
      }

      const scan = body as ScanResult;
      setEntries((prev) => [
        {
          scanId: scan.scanId,
          card: scan.card,
          value: scan.pricing?.headline?.price ?? null,
          thumb: scan.card?.images.small ?? null,
          unidentified: !scan.card,
        },
        ...prev,
      ]);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }, []);

  const { priced, unpriced, total, valuableCount } = useMemo(() => {
    const priced = entries
      .filter((e): e is Entry & { value: Money } => e.value !== null)
      .sort((a, b) => b.value.amount - a.value.amount);
    const unpriced = entries.filter((e) => e.value === null);

    // Only sum within a single currency — a mixed total is a wrong number.
    const usd = priced.filter((e) => e.value.currency === 'USD');
    const eur = priced.filter((e) => e.value.currency === 'EUR');
    const dominant = usd.length >= eur.length ? usd : eur;
    const total: Money | null = dominant.length
      ? {
          amount: dominant.reduce((s, e) => s + e.value.amount, 0),
          currency: dominant[0]!.value.currency,
        }
      : null;

    return {
      priced,
      unpriced,
      total,
      valuableCount: priced.filter((e) => e.value.amount >= threshold).length,
    };
  }, [entries, threshold]);

  return (
    <div className="px-4 pt-6">
      <h1 className="text-xl font-semibold tracking-tight">Bulk scan</h1>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-300">
        Scan through a pile. Cards are ranked by value so you can see what deserves a closer look.
      </p>

      <div className="mt-4">
        <CameraCapture onCapture={onCapture} busy={busy} shutterLabel="Add to pile" />
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-bad-500/40 bg-bad-500/10 p-3 text-[13px] text-bad-400">
          {error}
        </div>
      )}

      {entries.length > 0 && (
        <>
          <div className="mt-5 grid grid-cols-3 gap-2">
            <Stat label="Scanned" value={String(entries.length)} />
            <Stat label="Worth a look" value={String(valuableCount)} accent />
            <Stat label="Pile total" value={total ? formatMoney(total) : '—'} />
          </div>

          <div className="mt-4 flex items-center gap-3 rounded-xl border border-ink-800 bg-ink-900/60 p-3">
            <label htmlFor="threshold" className="shrink-0 text-[12px] text-ink-300">
              Flag above
            </label>
            <input
              id="threshold"
              type="range"
              min={1}
              max={100}
              step={1}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="flex-1 accent-bolt-500"
            />
            <span className="w-12 shrink-0 text-right font-mono text-[13px] text-bolt-400">
              ${threshold}
            </span>
          </div>

          <ul className="mt-4 space-y-2">
            {priced.map((e) => (
              <EntryRow key={e.scanId} entry={e} valuable={e.value.amount >= threshold} />
            ))}
          </ul>

          {unpriced.length > 0 && (
            <section className="mt-5">
              <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-400">
                Needs another look ({unpriced.length})
              </h2>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-500">
                These could not be identified or priced. That is not the same as being worthless —
                rescan them straight-on with better light.
              </p>
              <ul className="mt-2 space-y-2">
                {unpriced.map((e) => (
                  <EntryRow key={e.scanId} entry={e} valuable={false} />
                ))}
              </ul>
            </section>
          )}

          <button
            type="button"
            onClick={() => setEntries([])}
            className="mt-5 w-full rounded-xl border border-ink-700 px-4 py-3 text-sm font-medium text-ink-200 hover:bg-ink-850"
          >
            Clear pile
          </button>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-3">
      <div className="text-[10px] uppercase tracking-wide text-ink-400">{label}</div>
      <div className={`mt-0.5 font-mono text-lg font-semibold ${accent ? 'text-bolt-400' : 'text-ink-100'}`}>
        {value}
      </div>
    </div>
  );
}

function EntryRow({ entry, valuable }: { entry: Entry; valuable: boolean }) {
  const body = (
    <div
      className={`flex items-center gap-3 rounded-lg border p-2.5 ${
        valuable ? 'border-bolt-500/40 bg-bolt-500/10' : 'border-ink-800 bg-ink-900/60'
      }`}
    >
      {entry.thumb ? (
        <Image
          src={entry.thumb}
          alt=""
          width={36}
          height={50}
          className="h-[50px] w-9 shrink-0 rounded object-cover"
          unoptimized
        />
      ) : (
        <div className="h-[50px] w-9 shrink-0 rounded bg-ink-800" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-ink-100">
          {entry.card?.name ?? 'Not identified'}
        </div>
        <div className="truncate text-[11px] text-ink-400">
          {entry.card ? `${entry.card.set.name} · ${entry.card.number}` : 'Rescan for a result'}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className={`font-mono text-[13px] ${valuable ? 'text-bolt-400' : 'text-ink-200'}`}>
          {entry.value ? formatMoney(entry.value) : '—'}
        </div>
      </div>
    </div>
  );

  return <li>{entry.card ? <Link href={`/card/${entry.card.id}`}>{body}</Link> : body}</li>;
}

function formatMoney(m: Money): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: m.currency,
    maximumFractionDigits: m.amount >= 100 ? 0 : 2,
  }).format(m.amount);
}
