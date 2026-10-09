import Link from 'next/link';
import Image from 'next/image';
import { listCollection } from '@/lib/db';
import { getCardsCached } from '@/lib/tcg-cache';
import { fetchConditions } from '@/lib/pricing/engine';
import { holdingPrice } from '@/lib/pricing/holding-price';
import type { ConditionPricing } from '@/lib/pricing/sources/tcgplayer-listings';
import { toCard } from '@/lib/tcg-api';
import type { Money } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function CollectionPage() {
  const entries = listCollection();

  if (entries.length === 0) {
    return (
      <div className="px-4 pt-6">
        <h1 className="text-xl font-semibold tracking-tight">Collection</h1>
        <div className="mt-6 rounded-xl border border-ink-800 bg-ink-900/60 p-6 text-center">
          <p className="text-[13px] text-ink-300">No cards saved yet.</p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-400">
            Save the exact printing and condition so matching listing samples can be shown.
          </p>
          <Link
            href="/scan"
            className="mt-4 inline-block rounded-lg bg-bolt-500 px-4 py-2 text-[13px] font-semibold text-ink-950 hover:bg-bolt-400"
          >
            Scan a card
          </Link>
        </div>
      </div>
    );
  }

  const { cards, failed } = await getCardsCached(entries.map((e) => e.cardId));

  const samples = new Map<string, ConditionPricing | null>();
  for (const entry of entries) {
    const raw = cards.get(entry.cardId);
    const key = `${entry.cardId}:${entry.variant}`;
    if (raw && entry.conditionKey.startsWith('raw:') && !samples.has(key)) {
      samples.set(key, await fetchConditions(toCard(raw), entry.variant));
    }
  }
  const rows = entries.map((entry) => {
    const raw = cards.get(entry.cardId);
    if (!raw) return { entry, card: null, value: null as Money | null };
    return {
      entry,
      card: toCard(raw),
      value: holdingPrice(entry, samples.get(`${entry.cardId}:${entry.variant}`) ?? null),
    };
  });

  const usd = rows.filter((r) => r.value?.currency === 'USD');
  const total: Money | null = usd.length
    ? {
        amount: usd.reduce((s, r) => s + (r.value?.amount ?? 0) * r.entry.quantity, 0),
        currency: 'USD',
      }
    : null;

  return (
    <div className="px-4 pt-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Collection</h1>
        <span className="text-[12px] text-ink-400">{entries.length} cards</span>
      </div>

      {total && (
        <div className="mt-4 rounded-xl border border-ink-800 bg-ink-900/60 p-4">
          <div className="text-[11px] uppercase tracking-wide text-ink-400">
            Matching listing samples (USD subtotal)
          </div>
          <div className="mt-1 font-mono text-2xl font-semibold text-ink-100">
            {formatMoney(total)}
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-400">
            Sums sample medians for the saved printing and condition, multiplied by quantity.
            Only verified English samples from the past 24 hours are included. This is an asking-price
            comparison, excluding shipping and tax. {rows.length - usd.length} entries have no matching fresh price and are excluded.
          </p>
        </div>
      )}

      {failed.length > 0 && (
        <p className="mt-3 rounded-lg border border-ink-800 bg-ink-900/40 p-3 text-[12px] text-ink-400">
          {failed.length} {failed.length === 1 ? 'card' : 'cards'} could not be refreshed — the card
          database is unreachable right now.
        </p>
      )}

      <ul className="mt-4 space-y-2">
        {rows.map(({ entry, card, value }) => (
          <li key={entry.id}>
            <Link
              href={card ? `/card/${card.id}?variant=${entry.variant}` : '#'}
              className="flex items-center gap-3 rounded-lg border border-ink-800 bg-ink-900/60 p-2.5 hover:bg-ink-850"
            >
              {card ? (
                <Image
                  src={card.images.small}
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
                  {card?.name ?? entry.cardId}
                </div>
                <div className="truncate text-[11px] text-ink-400">
                  {card ? card.set.name : 'Unavailable'}
                  {` · ${entry.variant} · ${entry.conditionKey.replace('raw:', '')}`}
                  {entry.quantity > 1 && ` · ×${entry.quantity}`}
                </div>
              </div>
              <div className="shrink-0 font-mono text-[13px] text-ink-200">
                {value ? formatMoney(value) : '—'}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatMoney(m: Money): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: m.currency,
    maximumFractionDigits: m.amount >= 100 ? 0 : 2,
  }).format(m.amount);
}
