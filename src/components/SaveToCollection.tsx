'use client';

import { useState } from 'react';
import { RAW_CONDITIONS, RAW_CONDITION_LABELS, type PrintVariant, type RawCondition } from '@/lib/types';

/**
 * Save a card, recording the condition the user actually has.
 *
 * The condition selector is not optional decoration — a collection that assumes
 * everything is Near Mint overstates its value, often substantially. Asking once
 * at save time is the only point where the user genuinely knows the answer.
 */
export function SaveToCollection({
  cardId,
  variants,
}: {
  cardId: string;
  variants: PrintVariant[];
}) {
  const [open, setOpen] = useState(false);
  const [condition, setCondition] = useState<RawCondition>('NM');
  const [variant, setVariant] = useState<PrintVariant>(variants[0] ?? 'normal');
  const [quantity, setQuantity] = useState(1);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function save() {
    setState('saving');
    try {
      const res = await fetch('/api/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId, variant, condition, quantity }),
      });
      setState(res.ok ? 'saved' : 'error');
      if (res.ok) setOpen(false);
    } catch {
      setState('error');
    }
  }

  if (state === 'saved') {
    return (
      <div className="mt-4 rounded-xl border border-good-500/40 bg-good-500/10 p-3 text-center text-[13px] text-good-400">
        Saved to your collection.
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 w-full rounded-xl border border-ink-700 px-4 py-3 text-sm font-medium text-ink-200 hover:bg-ink-850"
      >
        Add to collection
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-ink-800 bg-ink-900/60 p-4">
      <h3 className="text-[13px] font-semibold text-ink-100">Add to collection</h3>

      <label className="mt-3 block">
        <span className="text-[11px] uppercase tracking-wide text-ink-400">Condition</span>
        <select
          value={condition}
          onChange={(e) => setCondition(e.target.value as RawCondition)}
          className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-ink-100"
        >
          {RAW_CONDITIONS.map((c) => (
            <option key={c} value={c}>
              {RAW_CONDITION_LABELS[c]}
            </option>
          ))}
        </select>
      </label>

      {variants.length > 1 && (
        <label className="mt-3 block">
          <span className="text-[11px] uppercase tracking-wide text-ink-400">Printing</span>
          <select
            value={variant}
            onChange={(e) => setVariant(e.target.value as PrintVariant)}
            className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-ink-100"
          >
            {variants.map((v) => (
              <option key={v} value={v}>
                {v.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="mt-3 block">
        <span className="text-[11px] uppercase tracking-wide text-ink-400">Quantity</span>
        <input
          type="number"
          min={1}
          max={999}
          value={quantity}
          onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
          className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-ink-100"
        />
      </label>

      {state === 'error' && (
        <p className="mt-2 text-[12px] text-bad-400">Could not save. Try again.</p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={state === 'saving'}
          className="flex-1 rounded-lg bg-bolt-500 px-4 py-2.5 text-[13px] font-semibold text-ink-950 hover:bg-bolt-400 disabled:bg-ink-700 disabled:text-ink-400"
        >
          {state === 'saving' ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-ink-700 px-4 py-2.5 text-[13px] text-ink-300 hover:bg-ink-850"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
