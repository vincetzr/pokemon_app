/**
 * Local SQLite store.
 *
 * Its main job is accruing GENUINE price history: every time we fetch prices we
 * append an immutable snapshot. Day one the chart is sparse; after a few weeks
 * of running the daily snapshot job it is real observed history that belongs to
 * the user and does not depend on any paid API.
 *
 * Deployment note: this assumes a writable, persistent filesystem. On ephemeral
 * serverless hosts the file resets on every cold start — point DATABASE_PATH at
 * a mounted volume, or run the snapshot job somewhere durable. If the database
 * cannot be opened the app degrades to read-only (live prices still work, and
 * accrued history is simply empty) rather than crashing.
 */

import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Condition, Money, PricePoint, PriceSource, Provenance, PrintVariant } from './types';
import { conditionKey } from './types';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS price_snapshots (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id        TEXT    NOT NULL,
  variant        TEXT    NOT NULL,
  condition_key  TEXT    NOT NULL,
  amount         REAL    NOT NULL,
  currency       TEXT    NOT NULL CHECK (currency IN ('USD','EUR')),
  provenance     TEXT    NOT NULL CHECK (provenance IN ('observed','recorded','backfilled','modeled')),
  source         TEXT    NOT NULL,
  -- The date the PRICE refers to, not when we wrote the row.
  as_of          TEXT    NOT NULL,
  recorded_at    TEXT    NOT NULL,
  -- One row per card/variant/condition/source/day. Re-running the snapshot job
  -- is idempotent instead of duplicating points.
  UNIQUE (card_id, variant, condition_key, source, as_of)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_lookup
  ON price_snapshots (card_id, variant, condition_key, as_of);

CREATE TABLE IF NOT EXISTS collection (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id       TEXT    NOT NULL,
  variant       TEXT    NOT NULL,
  condition_key TEXT    NOT NULL,
  quantity      INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  notes         TEXT,
  image_ref     TEXT,
  added_at      TEXT    NOT NULL,
  UNIQUE (card_id, variant, condition_key)
);

CREATE TABLE IF NOT EXISTS scans (
  scan_id     TEXT PRIMARY KEY,
  card_id     TEXT,
  captured_at TEXT NOT NULL,
  -- Full ScanResult as JSON, so history survives schema evolution.
  payload     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scans_captured ON scans (captured_at DESC);

-- Response cache for the Pokemon TCG API.
--
-- Measured against the live API, broad queries fail often: repeated identical
-- requests returned 500/502 roughly half the time, and even narrow ones fail
-- intermittently. Identification cannot be one API call away from breaking, so
-- successful responses are persisted and reused. Card and set data is static;
-- only the embedded prices age, and those are refreshed on their own cadence.
CREATE TABLE IF NOT EXISTS api_cache (
  cache_key  TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_cache_fetched ON api_cache (fetched_at);
`;

let db: Db | null = null;
let openFailed = false;

/**
 * Resolve the database location.
 *
 * The default is built with `join(process.cwd(), ...)` rather than resolving a
 * dynamic string, because the bundler's static analysis treats an arbitrary
 * runtime path as "this module may read anything" and responds by tracing the
 * entire project — including `public/` — into the server bundle. Keeping the
 * default statically scoped avoids that; an explicit DATABASE_PATH is an
 * operator decision made outside the bundle, so it opts out deliberately.
 */
function databasePath(): string {
  const configured = process.env.DATABASE_PATH;
  if (!configured) return join(process.cwd(), 'data', 'prices.db');
  return resolve(/* turbopackIgnore: true */ configured);
}

/** Returns the database, or null if it could not be opened (read-only mode). */
export function getDb(): Db | null {
  if (db) return db;
  if (openFailed) return null;

  try {
    const path = databasePath();
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const handle = new Database(path);
    handle.exec(SCHEMA);
    db = handle;
    return db;
  } catch (err) {
    openFailed = true;
    console.warn(
      `[db] could not open price database (${err instanceof Error ? err.message : err}). ` +
        'Running without accrued price history.',
    );
    return null;
  }
}

export interface SnapshotInput {
  cardId: string;
  variant: PrintVariant;
  condition: Condition;
  price: Money;
  provenance: Provenance;
  source: PriceSource;
  asOf: string;
}

/**
 * Append snapshots. Modeled figures are rejected outright: the history store is
 * a record of observations, and letting estimates in would make every chart
 * downstream unable to tell real data from our own guesses.
 */
export function recordSnapshots(rows: SnapshotInput[]): number {
  const handle = getDb();
  if (!handle || rows.length === 0) return 0;

  const real = rows.filter((r) => r.provenance !== 'modeled');
  if (real.length === 0) return 0;

  const stmt = handle.prepare(`
    INSERT INTO price_snapshots
      (card_id, variant, condition_key, amount, currency, provenance, source, as_of, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (card_id, variant, condition_key, source, as_of) DO NOTHING
  `);

  const now = new Date().toISOString();
  const insertAll = handle.transaction((items: SnapshotInput[]) => {
    let n = 0;
    for (const r of items) {
      if (!Number.isFinite(r.price.amount) || r.price.amount <= 0) continue;
      const info = stmt.run(
        r.cardId,
        r.variant,
        conditionKey(r.condition),
        r.price.amount,
        r.price.currency,
        r.provenance,
        r.source,
        r.asOf,
        now,
      );
      n += info.changes;
    }
    return n;
  });

  return insertAll(real);
}

interface SnapshotRow {
  amount: number;
  currency: 'USD' | 'EUR';
  provenance: Provenance;
  source: PriceSource;
  as_of: string;
}

/** Read accrued history for one card/variant/condition, oldest first. */
export function readHistory(
  cardId: string,
  variant: PrintVariant,
  condition: Condition,
  opts: { since?: string } = {},
): PricePoint[] {
  const handle = getDb();
  if (!handle) return [];

  const rows = handle
    .prepare(
      `SELECT amount, currency, provenance, source, as_of
         FROM price_snapshots
        WHERE card_id = ? AND variant = ? AND condition_key = ?
          AND (? IS NULL OR as_of >= ?)
        ORDER BY as_of ASC`,
    )
    .all(
      cardId,
      variant,
      conditionKey(condition),
      opts.since ?? null,
      opts.since ?? null,
    ) as SnapshotRow[];

  return rows.map((r) => ({
    date: r.as_of,
    price: { amount: r.amount, currency: r.currency },
    provenance: r.provenance,
    source: r.source,
  }));
}

/** How many real observations we hold — drives the "history is still filling up" UI. */
export function historyStats(cardId: string): { points: number; earliest: string | null } {
  const handle = getDb();
  if (!handle) return { points: 0, earliest: null };

  const row = handle
    .prepare(
      `SELECT COUNT(*) AS points, MIN(as_of) AS earliest
         FROM price_snapshots WHERE card_id = ?`,
    )
    .get(cardId) as { points: number; earliest: string | null };

  return { points: row?.points ?? 0, earliest: row?.earliest ?? null };
}

/** Every card we have ever snapshotted — the work list for the daily job. */
export function trackedCardIds(): string[] {
  const handle = getDb();
  if (!handle) return [];
  const rows = handle
    .prepare(
      `SELECT DISTINCT card_id FROM (
         SELECT card_id FROM collection
         UNION
         SELECT card_id FROM price_snapshots
       ) ORDER BY card_id`,
    )
    .all() as { card_id: string }[];
  return rows.map((r) => r.card_id);
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

export interface CollectionEntry {
  id: number;
  cardId: string;
  variant: PrintVariant;
  conditionKey: string;
  quantity: number;
  notes: string | null;
  imageRef: string | null;
  addedAt: string;
}

export function addToCollection(input: {
  cardId: string;
  variant: PrintVariant;
  condition: Condition;
  quantity?: number;
  notes?: string;
  imageRef?: string;
}): void {
  const handle = getDb();
  if (!handle) return;

  handle
    .prepare(
      `INSERT INTO collection (card_id, variant, condition_key, quantity, notes, image_ref, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (card_id, variant, condition_key)
       DO UPDATE SET quantity = quantity + excluded.quantity`,
    )
    .run(
      input.cardId,
      input.variant,
      conditionKey(input.condition),
      input.quantity ?? 1,
      input.notes ?? null,
      input.imageRef ?? null,
      new Date().toISOString(),
    );
}

export function listCollection(): CollectionEntry[] {
  const handle = getDb();
  if (!handle) return [];
  const rows = handle
    .prepare(`SELECT * FROM collection ORDER BY added_at DESC`)
    .all() as Record<string, unknown>[];

  return rows.map((r) => ({
    id: r.id as number,
    cardId: r.card_id as string,
    variant: r.variant as PrintVariant,
    conditionKey: r.condition_key as string,
    quantity: r.quantity as number,
    notes: (r.notes as string | null) ?? null,
    imageRef: (r.image_ref as string | null) ?? null,
    addedAt: r.added_at as string,
  }));
}

export function removeFromCollection(id: number): void {
  getDb()?.prepare(`DELETE FROM collection WHERE id = ?`).run(id);
}

// ---------------------------------------------------------------------------
// API response cache
// ---------------------------------------------------------------------------

export interface CachedResponse<T> {
  payload: T;
  fetchedAt: string;
  ageSeconds: number;
}

/** Read a cached API response, or null when absent. Age is left to the caller
 *  to judge, so a stale entry can still be used as a fallback during an outage. */
export function readCache<T>(key: string): CachedResponse<T> | null {
  const handle = getDb();
  if (!handle) return null;

  try {
    const row = handle
      .prepare(`SELECT payload, fetched_at FROM api_cache WHERE cache_key = ?`)
      .get(key) as { payload: string; fetched_at: string } | undefined;
    if (!row) return null;

    return {
      payload: JSON.parse(row.payload) as T,
      fetchedAt: row.fetched_at,
      ageSeconds: (Date.now() - new Date(row.fetched_at).getTime()) / 1000,
    };
  } catch {
    return null;
  }
}

export function writeCache(key: string, payload: unknown): void {
  const handle = getDb();
  if (!handle) return;

  try {
    handle
      .prepare(
        `INSERT INTO api_cache (cache_key, payload, fetched_at) VALUES (?, ?, ?)
         ON CONFLICT (cache_key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
      )
      .run(key, JSON.stringify(payload), new Date().toISOString());
  } catch {
    // A cache write failure must never break the request that succeeded.
  }
}

/** Drop cache entries older than `maxAgeDays`. */
export function pruneCache(maxAgeDays = 30): number {
  const handle = getDb();
  if (!handle) return 0;
  const cutoff = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString();
  return handle.prepare(`DELETE FROM api_cache WHERE fetched_at < ?`).run(cutoff).changes;
}
