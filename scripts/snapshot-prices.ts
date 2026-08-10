/**
 * Daily price snapshot job.
 *
 * Records today's real prices for every card the user has saved or previously
 * looked at. This is what turns the app from something that shows a price into
 * something that shows a price HISTORY — each run appends one more real
 * observation per card, and the record belongs to the user rather than to a
 * paid data vendor.
 *
 * Run it from cron:
 *   0 6 * * *  cd /path/to/app && npm run snapshot >> snapshot.log 2>&1
 *
 * Safe to run repeatedly: snapshots are unique per card/variant/condition/
 * source/day, so a second run on the same day inserts nothing.
 */

import { getRawCard } from '../src/lib/tcg-api';
import { quotesForCard } from '../src/lib/pricing/quotes';
import { recordSnapshots, trackedCardIds, pruneCache, getDb } from '../src/lib/db';

const CONCURRENCY = 3;
const PAUSE_MS = 250;

async function main(): Promise<void> {
  const started = Date.now();

  if (!getDb()) {
    console.error('Could not open the database. Check DATABASE_PATH and filesystem permissions.');
    process.exit(1);
  }

  const ids = trackedCardIds();
  if (ids.length === 0) {
    console.log('No cards tracked yet — save a card or scan one, then run this again.');
    return;
  }

  console.log(`Snapshotting ${ids.length} card${ids.length === 1 ? '' : 's'}…`);

  let recorded = 0;

  async function runPass(work: string[]): Promise<string[]> {
    const queue = [...work];
    const stillFailing: string[] = [];

    async function worker(): Promise<void> {
      for (;;) {
        const id = queue.shift();
        if (id === undefined) return;

        try {
          const raw = await getRawCard(id);
          if (!raw) {
            stillFailing.push(id);
            continue;
          }

          const quotes = quotesForCard(raw).filter((q) => q.provenance === 'observed');
          recorded += recordSnapshots(
            quotes.map((q) => ({
              cardId: q.cardId,
              variant: q.variant,
              condition: q.condition,
              price: q.price,
              provenance: 'recorded' as const,
              source: q.source,
              asOf: q.asOf,
            })),
          );
        } catch {
          stillFailing.push(id);
        }

        // The upstream API is unreliable under load; pacing improves the hit rate.
        await new Promise((r) => setTimeout(r, PAUSE_MS));
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    return stillFailing;
  }

  // Sweep failures in additional passes.
  //
  // Measured, the upstream API succeeds on roughly 3 requests in 10 during a bad
  // spell. Even with the client's own retries that leaves around one card in
  // eight unrecorded per pass — and a missed day is a permanent hole in the
  // history, since prices cannot be backfilled after the fact. This is a
  // nightly batch job, so trading a few minutes for near-complete coverage is
  // straightforwardly worth it.
  let outstanding = await runPass(ids);
  for (let pass = 2; pass <= 4 && outstanding.length > 0; pass++) {
    console.log(`  pass ${pass}: retrying ${outstanding.length} card${outstanding.length === 1 ? '' : 's'}…`);
    await new Promise((r) => setTimeout(r, 3000 * (pass - 1)));
    outstanding = await runPass(outstanding);
  }

  const failed = outstanding.length;
  if (failed > 0) {
    console.warn(`  unavailable after 4 passes: ${outstanding.join(', ')}`);
  }

  const pruned = pruneCache(30);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(
    `Done in ${seconds}s — ${recorded} new price point${recorded === 1 ? '' : 's'} recorded` +
      `${failed > 0 ? `, ${failed} card${failed === 1 ? '' : 's'} unavailable` : ''}` +
      `${pruned > 0 ? `, ${pruned} stale cache entries pruned` : ''}.`,
  );

  if (failed > 0 && recorded === 0) {
    // Every lookup failed — likely an outage rather than a data problem. Exit
    // non-zero so a cron wrapper can alert instead of silently doing nothing.
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
