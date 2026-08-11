import type { ConditionPricing } from '@/lib/pricing/sources/tcgplayer-listings';
import { RAW_CONDITION_LABELS, type Money } from '@/lib/types';

/**
 * Real per-condition prices from live listings.
 *
 * Two presentation decisions carry most of the honesty here.
 *
 * The listing count is shown for every row, not tucked away. Real market data
 * is not monotonic: measured live, a Pikachu's Lightly Played low ($49.99) sat
 * above its Near Mint low ($40.00), and a Cinderace V's Heavily Played median
 * exceeded its Near Mint median — on 4 and 2 listings respectively. A price
 * backed by two listings is a rumour; the count is what lets a reader tell the
 * difference, so it sits in the table rather than in a footnote.
 *
 * And these are asking prices. What a seller wants is not what a card sells
 * for, and the gap widens as condition falls. The panel says so plainly rather
 * than implying these are sale values.
 */
export function ConditionPrices({ pricing }: { pricing: ConditionPricing }) {
  const thin = pricing.prices.filter((p) => p.listingCount < 5).length;

  return (
    <section className="mt-4 rounded-xl border border-ink-800 bg-ink-900/60 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-semibold text-ink-100">Price by condition</h2>
        <span className="text-[10px] uppercase tracking-wide text-ink-500">live listings</span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
        What sellers are currently asking on TCGplayer, per condition. These are asking prices,
        not completed sales — cards usually sell below the asking price, and the gap widens as
        condition falls.
      </p>

      <table className="mt-3 w-full text-left text-[12px]">
        <thead>
          <tr className="border-b border-ink-800 text-[10px] uppercase tracking-wide text-ink-500">
            <th scope="col" className="pb-1.5 font-medium">Condition</th>
            <th scope="col" className="pb-1.5 text-right font-medium">Cheapest</th>
            <th scope="col" className="pb-1.5 text-right font-medium">Typical</th>
            <th scope="col" className="pb-1.5 text-right font-medium">Listings</th>
          </tr>
        </thead>
        <tbody>
          {pricing.prices.map((p) => {
            const weak = p.listingCount < 5;
            return (
              <tr key={p.condition} className="border-b border-ink-850/60 last:border-0">
                <td className="py-1.5 text-ink-200">{RAW_CONDITION_LABELS[p.condition]}</td>
                <td className="py-1.5 text-right font-mono text-ink-100">{money(p.low)}</td>
                <td className="py-1.5 text-right font-mono text-ink-100">{money(p.median)}</td>
                <td
                  className={`py-1.5 text-right font-mono ${weak ? 'text-warn-400' : 'text-ink-400'}`}
                  title={weak ? 'Very few listings — treat this row as a weak signal' : undefined}
                >
                  {p.listingCount}
                  {weak && <span aria-hidden> ⚠</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {thin > 0 && (
        <p className="mt-2.5 text-[11px] leading-relaxed text-warn-400">
          {thin === 1 ? 'One condition is' : `${thin} conditions are`} backed by fewer than five
          listings. With that little supply the figures move a lot, and a played card can even
          list above a mint one — read those rows as rough, not as a market price.
        </p>
      )}

      <p className="mt-2 text-[10px] text-ink-500">
        Fetched {new Date(pricing.fetchedAt).toLocaleString()} · TCGplayer product {pricing.productId}
      </p>
    </section>
  );
}

function money(m: Money): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: m.currency,
    maximumFractionDigits: m.amount >= 100 ? 0 : 2,
  }).format(m.amount);
}
