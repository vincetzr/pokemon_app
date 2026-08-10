'use client';

import { useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Money, PricePoint, PriceSeries } from '@/lib/types';
import { conditionKey, conditionLabel } from '@/lib/types';

/**
 * Price history, with provenance encoded in the mark itself.
 *
 *   solid line    real prices — observed at a marketplace, or recorded by this app
 *   dashed line   backfilled from a paid third-party source
 *   shaded band   a modeled estimate, never a line
 *
 * Using line STYLE rather than colour for provenance is deliberate: colour is
 * carrying series identity (which condition), and one channel cannot carry two
 * meanings. It also means the real/estimated distinction survives greyscale,
 * colour-blindness, and a printed page.
 *
 * Palette: categorical slots 1–3, validated against this app's dark surface
 * (#0e1016) — worst adjacent CVD ΔE 9.4, normal-vision ΔE 26.5, all ≥3:1 contrast.
 */

const SERIES_COLORS = ['#3987e5', '#d95926', '#199e70'] as const;

const INK = {
  grid: '#2c2c2a',
  axis: '#383835',
  muted: '#898781',
  secondary: '#c3c2b7',
  surface: '#0e1016',
} as const;

interface Props {
  series: PriceSeries[];
  /** Currency to display. Series in other currencies are excluded, never converted. */
  currency: Money['currency'];
}

interface Row {
  date: string;
  [key: string]: string | number | [number, number] | null;
}

export function PriceChart({ series, currency }: Props) {
  const [showTable, setShowTable] = useState(false);

  // Never mix currencies on one axis — a EUR point plotted against USD is simply
  // a wrong number, and no amount of labelling fixes it.
  const usable = useMemo(
    () =>
      series
        .filter((s) => s.points.some((p) => p.price.currency === currency))
        .slice(0, SERIES_COLORS.length),
    [series, currency],
  );

  const { rows, keys } = useMemo(() => buildRows(usable, currency), [usable, currency]);

  if (usable.length === 0 || rows.length < 2) {
    return (
      <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-6 text-center">
        <p className="text-[13px] text-ink-300">Not enough price history to chart yet.</p>
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-400">
          This app records real prices each day it runs, so the chart fills in over time.
        </p>
      </div>
    );
  }

  const hasEstimates = keys.some((k) => k.kind === 'modeled');

  return (
    <figure className="rounded-xl border border-ink-800 bg-ink-900/60 p-3">
      <figcaption className="mb-2 px-1">
        <h3 className="text-[13px] font-semibold text-ink-100">
          Price history{usable.length === 1 ? ` — ${conditionLabel(usable[0]!.condition)}` : ''}
        </h3>
        <p className="mt-0.5 text-[11px] text-ink-400">
          {currency === 'USD' ? 'TCGplayer, US dollars' : 'Cardmarket, euros'}
        </p>
      </figcaption>

      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 6, right: 10, bottom: 4, left: -8 }}>
            <defs>
              {/* Hatched fill marks estimated regions, so "this is a guess" reads
                  even without colour. */}
              <pattern id="estimate-hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
                <rect width="6" height="6" fill="transparent" />
                <line x1="0" y1="0" x2="0" y2="6" stroke={INK.muted} strokeWidth="2" opacity="0.35" />
              </pattern>
            </defs>

            <CartesianGrid stroke={INK.grid} strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: INK.muted, fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: INK.axis }}
              tickFormatter={shortDate}
              minTickGap={28}
            />
            <YAxis
              tick={{ fill: INK.muted, fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(v: number) => compactMoney(v, currency)}
            />
            <Tooltip
              contentStyle={{
                background: INK.surface,
                border: `1px solid ${INK.axis}`,
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: INK.secondary, marginBottom: 4 }}
              cursor={{ stroke: INK.muted, strokeWidth: 1 }}
              formatter={(value, name) => [
                typeof value === 'number' ? formatMoney(value, currency) : '—',
                String(name ?? ''),
              ]}
              labelFormatter={(label) => longDate(String(label ?? ''))}
            />
            {usable.length > 1 && (
              <Legend
                wrapperStyle={{ fontSize: 11, color: INK.secondary, paddingTop: 4 }}
                iconType="plainline"
                iconSize={14}
              />
            )}

            {keys.map((k) =>
              k.kind === 'modeled' ? (
                <Area
                  key={k.dataKey}
                  dataKey={k.dataKey}
                  name={`${k.label} (estimate)`}
                  stroke="none"
                  fill="url(#estimate-hatch)"
                  isAnimationActive={false}
                  connectNulls
                />
              ) : (
                <Line
                  key={k.dataKey}
                  type="monotone"
                  dataKey={k.dataKey}
                  name={k.label}
                  stroke={k.color}
                  strokeWidth={2}
                  strokeDasharray={k.kind === 'backfilled' ? '5 4' : undefined}
                  dot={{ r: 2.5, fill: k.color, strokeWidth: 0 }}
                  activeDot={{ r: 5, stroke: INK.surface, strokeWidth: 2 }}
                  isAnimationActive={false}
                  connectNulls
                />
              ),
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1 text-[10px] text-ink-400">
        <LegendKey kind="real">recorded / observed</LegendKey>
        {keys.some((k) => k.kind === 'backfilled') && (
          <LegendKey kind="backfilled">backfilled</LegendKey>
        )}
        {hasEstimates && <LegendKey kind="modeled">estimate</LegendKey>}
      </div>

      <button
        type="button"
        onClick={() => setShowTable((s) => !s)}
        className="mt-2 w-full rounded-lg border border-ink-800 px-3 py-1.5 text-[12px] text-ink-300 hover:bg-ink-850"
        aria-expanded={showTable}
      >
        {showTable ? 'Hide' : 'Show'} data as a table
      </button>

      {showTable && <DataTable rows={rows} keys={keys} currency={currency} />}
    </figure>
  );
}

function LegendKey({ kind, children }: { kind: 'real' | 'backfilled' | 'modeled'; children: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {kind === 'modeled' ? (
        <span className="estimate-hatch h-2.5 w-5 rounded-sm border border-ink-700" aria-hidden />
      ) : (
        <svg width="20" height="8" aria-hidden>
          <line
            x1="0"
            y1="4"
            x2="20"
            y2="4"
            stroke={INK.secondary}
            strokeWidth="2"
            strokeDasharray={kind === 'backfilled' ? '5 4' : undefined}
          />
        </svg>
      )}
      {children}
    </span>
  );
}

interface SeriesKey {
  dataKey: string;
  label: string;
  color: string;
  kind: 'real' | 'backfilled' | 'modeled';
}

/**
 * Flatten series into chart rows.
 *
 * Each condition contributes up to three data keys — real, backfilled, and
 * modeled — so the three can be drawn with different marks. Splitting by
 * provenance at the data level is what makes it impossible to accidentally draw
 * an estimate as a solid line.
 */
function buildRows(series: PriceSeries[], currency: Money['currency']): { rows: Row[]; keys: SeriesKey[] } {
  const byDate = new Map<string, Row>();
  const keys: SeriesKey[] = [];

  series.forEach((s, i) => {
    const color = SERIES_COLORS[i % SERIES_COLORS.length]!;
    const label = conditionLabel(s.condition);
    const base = conditionKey(s.condition).replace(/[^a-z0-9]/gi, '');

    const groups: Record<SeriesKey['kind'], PricePoint[]> = {
      real: [],
      backfilled: [],
      modeled: [],
    };

    for (const p of s.points) {
      if (p.price.currency !== currency) continue;
      if (p.provenance === 'modeled') groups.modeled.push(p);
      else if (p.provenance === 'backfilled') groups.backfilled.push(p);
      else groups.real.push(p);
    }

    for (const kind of ['real', 'backfilled', 'modeled'] as const) {
      const points = groups[kind];
      if (points.length === 0) continue;

      const dataKey = `${base}_${kind}`;
      keys.push({ dataKey, label, color, kind });

      for (const p of points) {
        const row = byDate.get(p.date) ?? { date: p.date };
        row[dataKey] =
          kind === 'modeled' && p.band ? [p.band.low, p.band.high] : p.price.amount;
        byDate.set(p.date, row);
      }
    }
  });

  const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { rows, keys };
}

function DataTable({ rows, keys, currency }: { rows: Row[]; keys: SeriesKey[]; currency: Money['currency'] }) {
  return (
    <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-ink-800">
      <table className="w-full text-left text-[11px]">
        <thead className="sticky top-0 bg-ink-900">
          <tr className="border-b border-ink-800">
            <th scope="col" className="px-2 py-1.5 font-medium text-ink-300">Date</th>
            {keys.map((k) => (
              <th key={k.dataKey} scope="col" className="px-2 py-1.5 text-right font-medium text-ink-300">
                {k.label}
                {k.kind !== 'real' && <span className="text-ink-500"> ({k.kind})</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {rows.map((row) => (
            <tr key={row.date} className="border-b border-ink-850/60">
              <td className="px-2 py-1 text-ink-400">{row.date}</td>
              {keys.map((k) => {
                const v = row[k.dataKey];
                return (
                  <td key={k.dataKey} className="px-2 py-1 text-right text-ink-200">
                    {typeof v === 'number' ? formatMoney(v, currency) : Array.isArray(v) ? `${formatMoney(v[0], currency)}–${formatMoney(v[1], currency)}` : '—'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatMoney(amount: number, currency: Money['currency']): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: amount >= 100 ? 0 : 2,
  }).format(amount);
}

function compactMoney(amount: number, currency: Money['currency']): string {
  const symbol = currency === 'USD' ? '$' : '€';
  if (amount >= 1000) return `${symbol}${(amount / 1000).toFixed(1)}k`;
  return `${symbol}${amount >= 10 ? Math.round(amount) : amount.toFixed(1)}`;
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
