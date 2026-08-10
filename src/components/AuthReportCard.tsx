'use client';

import { useState } from 'react';
import type { AuthReport, AuthSignal } from '@/lib/types';
import { NEXT_STEPS, VERDICT_META } from '@/lib/auth/engine';

/**
 * Renders an authenticity report.
 *
 * The presentation carries as much responsibility as the analysis. Three things
 * are deliberate: the confidence figure sits next to the verdict rather than
 * behind a link, abstaining checks are listed as prominently as the ones that
 * ran, and the limitations are always visible. A user who reads only the top of
 * this card should still come away knowing the result is not proof.
 */
export function AuthReportCard({ report }: { report: AuthReport }) {
  const [showSignals, setShowSignals] = useState(false);
  const meta = VERDICT_META[report.verdict];

  const tone = {
    good: { border: 'border-good-500/40', bg: 'bg-good-500/10', text: 'text-good-400' },
    warn: { border: 'border-warn-500/40', bg: 'bg-warn-500/10', text: 'text-warn-400' },
    bad: { border: 'border-bad-500/40', bg: 'bg-bad-500/10', text: 'text-bad-400' },
  }[meta.tone];

  const ran = report.signals.filter((s) => s.status === 'ok');
  const abstained = report.signals.filter((s) => s.status !== 'ok');

  return (
    <section className={`rounded-xl border ${tone.border} ${tone.bg} p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className={`text-[15px] font-semibold ${tone.text}`}>{meta.label}</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-200">{meta.blurb}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-lg font-semibold text-ink-100">{report.score}</div>
          <div className="text-[10px] uppercase tracking-wide text-ink-400">score</div>
        </div>
      </div>

      {/* Confidence sits beside the verdict, never hidden — a high score from two
          checks out of six is not the same as a high score from all six. */}
      <div className="mt-3 flex items-center gap-2 text-xs text-ink-300">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-800">
          <div
            className={`h-full rounded-full ${
              report.confidence > 0.6 ? 'bg-good-500' : report.confidence > 0.3 ? 'bg-warn-500' : 'bg-bad-500'
            }`}
            style={{ width: `${Math.round(report.confidence * 100)}%` }}
          />
        </div>
        <span className="font-mono tabular-nums">
          {Math.round(report.confidence * 100)}% confidence
        </span>
      </div>
      <p className="mt-1.5 text-[11px] text-ink-400">
        {ran.length} of {report.signals.length} checks ran
        {abstained.length > 0 && ` — ${abstained.length} could not`}
      </p>

      {report.concerns.length > 0 && (
        <div className="mt-4 rounded-lg border border-bad-500/30 bg-bad-500/5 p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-bad-400">Concerns</h3>
          <ul className="mt-2 space-y-1.5">
            {report.concerns.map((c) => (
              <li key={c} className="text-[13px] leading-relaxed text-ink-200">
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowSignals((s) => !s)}
        className="mt-4 flex w-full items-center justify-between rounded-lg border border-ink-700 px-3 py-2 text-[13px] font-medium text-ink-200 hover:bg-ink-850"
        aria-expanded={showSignals}
      >
        <span>Individual checks</span>
        <span className={`text-ink-400 transition-transform ${showSignals ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>

      {showSignals && (
        <ul className="mt-2 space-y-2">
          {report.signals.map((s) => (
            <SignalRow key={s.id} signal={s} />
          ))}
        </ul>
      )}

      <details className="mt-4">
        <summary className="cursor-pointer text-[13px] font-medium text-ink-200">
          What this can&rsquo;t tell you
        </summary>
        <ul className="mt-2 space-y-2">
          {report.limitations.map((l) => (
            <li key={l} className="text-[12px] leading-relaxed text-ink-400">
              {l}
            </li>
          ))}
        </ul>
      </details>

      <div className="mt-4 border-t border-ink-800 pt-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-400">What to do next</h3>
        <ol className="mt-2 space-y-1.5">
          {NEXT_STEPS[report.verdict].map((step, i) => (
            <li key={step} className="flex gap-2.5 text-[13px] leading-relaxed text-ink-200">
              <span className="mt-0.5 font-mono text-[11px] text-ink-500">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function SignalRow({ signal }: { signal: AuthSignal }) {
  const [open, setOpen] = useState(false);
  const measurements = Object.entries(signal.measurements);

  const badge =
    signal.status !== 'ok'
      ? { label: 'not run', cls: 'bg-ink-800 text-ink-400' }
      : (signal.score ?? 0) >= 70
        ? { label: String(signal.score), cls: 'bg-good-500/20 text-good-400' }
        : (signal.score ?? 0) >= 45
          ? { label: String(signal.score), cls: 'bg-warn-500/20 text-warn-400' }
          : { label: String(signal.score), cls: 'bg-bad-500/20 text-bad-400' };

  return (
    <li className="rounded-lg border border-ink-800 bg-ink-950/40 p-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start justify-between gap-3 text-left"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-ink-100">{signal.label}</div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-400">{signal.summary}</p>
        </div>
        <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] ${badge.cls}`}>
          {badge.label}
        </span>
      </button>

      {open && measurements.length > 0 && (
        <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-ink-800 pt-2.5">
          {measurements.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="truncate text-[11px] text-ink-500">{k}</dt>
              <dd className="text-right font-mono text-[11px] text-ink-300">{String(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}
