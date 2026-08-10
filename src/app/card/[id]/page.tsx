import Image from 'next/image';
import { notFound } from 'next/navigation';
import { getCardCached } from '@/lib/tcg-cache';
import { toCard } from '@/lib/tcg-api';
import { buildPricing } from '@/lib/pricing/engine';
import { seriesStats } from '@/lib/pricing/history';
import { historyStats } from '@/lib/db';
import { PriceChart } from '@/components/PriceChart';
import { conditionLabel, type Money, type PriceQuote } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function CardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cached = await getCardCached(id);
  if (!cached) notFound();

  const card = toCard(cached.data);
  const pricing = buildPricing(cached.data);
  const accrued = historyStats(id);

  const usdQuotes = pricing.quotes.filter((q) => q.price.currency === 'USD');
  const eurQuotes = pricing.quotes.filter((q) => q.price.currency === 'EUR');

  // Chart whichever currency actually has history behind it.
  //
  // Count points PER CURRENCY, not per series. A series mixes TCGplayer (USD)
  // and Cardmarket (EUR) points, so counting them together says "enough to
  // chart" when the currency the chart will actually draw has a single point —
  // which rendered an empty chart card next to a populated one.
  const countIn = (s: (typeof pricing.series)[number], currency: 'USD' | 'EUR') =>
    s.points.filter((p) => p.price.currency === currency).length;

  const usdSeries = pricing.series.filter((s) => countIn(s, 'USD') >= 2);
  const eurSeries = pricing.series.filter((s) => countIn(s, 'EUR') >= 2);

  const stats = eurSeries[0] ? seriesStats(eurSeries[0]) : usdSeries[0] ? seriesStats(usdSeries[0]) : null;

  return (
    <div className="px-4 pt-6">
      <div className="flex gap-4">
        <Image
          src={card.images.small}
          alt={`${card.name} card`}
          width={110}
          height={153}
          className="h-auto w-[110px] shrink-0 rounded-lg border border-ink-800"
          unoptimized
        />
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold leading-tight text-ink-100">{card.name}</h1>
          <p className="mt-1 text-[13px] text-ink-300">{card.set.name}</p>
          <p className="mt-0.5 text-[12px] text-ink-400">
            {card.number}/{card.set.printedTotal}
            {card.rarity && ` · ${card.rarity}`}
          </p>
          <p className="mt-0.5 text-[12px] text-ink-400">{card.set.releaseDate.replace(/\//g, '-')}</p>
          {card.artist && <p className="mt-0.5 text-[11px] text-ink-500">Illus. {card.artist}</p>}
        </div>
      </div>

      {pricing.headline && (
        <div className="mt-5 rounded-xl border border-ink-800 bg-ink-900/60 p-4">
          <div className="text-[11px] uppercase tracking-wide text-ink-400">
            Market price · Near Mint
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="font-mono text-3xl font-semibold text-ink-100">
              {formatMoney(pricing.headline.price)}
            </span>
            {stats && (
              <span
                className={`font-mono text-[13px] ${
                  stats.changePct >= 0 ? 'text-good-400' : 'text-bad-400'
                }`}
              >
                {stats.changePct >= 0 ? '▲' : '▼'} {Math.abs(stats.changePct).toFixed(1)}%
              </span>
            )}
          </div>
          <div className="mt-1 text-[12px] text-ink-400">
            {pricing.headline.source === 'tcgplayer' ? 'TCGplayer' : 'Cardmarket'} · as of{' '}
            {pricing.headline.asOf}
          </div>
        </div>
      )}

      <div className="mt-4 space-y-4">
        {eurSeries.length > 0 && <PriceChart series={eurSeries} currency="EUR" />}
        {usdSeries.length > 0 && <PriceChart series={usdSeries} currency="USD" />}
      </div>

      {accrued.points > 0 && (
        <p className="mt-2 px-1 text-[11px] text-ink-500">
          {accrued.points} price {accrued.points === 1 ? 'observation' : 'observations'} recorded by
          this app{accrued.earliest && ` since ${accrued.earliest}`}.
        </p>
      )}

      {usdQuotes.length > 0 && <QuoteTable title="TCGplayer (USD)" quotes={usdQuotes} />}
      {eurQuotes.length > 0 && <QuoteTable title="Cardmarket (EUR)" quotes={eurQuotes} />}

      {pricing.spreads.length > 0 && (
        <section className="mt-4 rounded-xl border border-ink-800 bg-ink-900/60 p-4">
          <h2 className="text-[13px] font-semibold text-ink-100">Current listing spread</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
            The range of live listings. This mixes conditions and sellers, so it is context rather
            than a price for any one condition.
          </p>
          <ul className="mt-3 space-y-3">
            {pricing.spreads.map((s) => (
              <li key={s.variant}>
                <div className="text-[12px] font-medium text-ink-200">{variantLabel(s.variant)}</div>
                <dl className="mt-1.5 grid grid-cols-4 gap-2">
                  {(['low', 'mid', 'high', 'directLow'] as const).map((k) => (
                    <div key={k}>
                      <dt className="text-[10px] uppercase tracking-wide text-ink-500">
                        {k === 'directLow' ? 'direct' : k}
                      </dt>
                      <dd className="font-mono text-[12px] text-ink-200">
                        {s[k] ? formatMoney(s[k]!) : '—'}
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pricing.caveats.length > 0 && (
        <section className="mt-4 rounded-xl border border-ink-800 bg-ink-900/40 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
            About this data
          </h2>
          <ul className="mt-2 space-y-2">
            {pricing.caveats.map((c) => (
              <li key={c} className="text-[12px] leading-relaxed text-ink-400">
                {c}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function QuoteTable({ title, quotes }: { title: string; quotes: PriceQuote[] }) {
  return (
    <section className="mt-4 rounded-xl border border-ink-800 bg-ink-900/60 p-4">
      <h2 className="text-[13px] font-semibold text-ink-100">{title}</h2>
      <table className="mt-3 w-full text-left text-[12px]">
        <thead>
          <tr className="border-b border-ink-800 text-[10px] uppercase tracking-wide text-ink-500">
            <th scope="col" className="pb-1.5 font-medium">Printing</th>
            <th scope="col" className="pb-1.5 font-medium">Condition</th>
            <th scope="col" className="pb-1.5 text-right font-medium">Price</th>
          </tr>
        </thead>
        <tbody>
          {quotes.map((q, i) => (
            <tr key={`${q.variant}-${i}`} className="border-b border-ink-850/60 last:border-0">
              <td className="py-1.5 text-ink-300">{variantLabel(q.variant)}</td>
              <td className="py-1.5 text-ink-300">
                {conditionLabel(q.condition)}
                {q.provenance === 'modeled' && (
                  <span className="ml-1.5 rounded bg-ink-800 px-1 py-0.5 text-[9px] uppercase text-ink-400">
                    est
                  </span>
                )}
              </td>
              <td className="py-1.5 text-right font-mono text-ink-100">{formatMoney(q.price)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function variantLabel(variant: string): string {
  return variant
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function formatMoney(m: Money): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: m.currency,
    maximumFractionDigits: m.amount >= 100 ? 0 : 2,
  }).format(m.amount);
}
