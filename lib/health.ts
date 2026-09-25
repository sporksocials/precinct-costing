/**
 * Data health: detect (and heal) a load that came back incomplete, so the app never shows costs or margins built
 * from partial data. Pure and framework free; lib/store.tsx wires it to Supabase and React.
 *
 * How it works
 * - The database can describe every cost_* table the app loads as {count, hash} (cost_data_fingerprint()).
 * - After a load the client compares its own per-table row COUNT (and checks for duplicate keys) against that
 *   fingerprint. No duplicates plus the same count means the set of rows is exactly the table's set.
 *   Hashes are NOT recomputed in the browser: the database hashes Postgres' own text form of each row (numeric
 *   scale, timestamp format, jsonb key order), which JavaScript cannot reproduce exactly, so a client hash would
 *   raise false alarms. The hash is compared remote-against-remote instead (see changedTables): it tells us that
 *   someone else changed a table since we last synced, and which one to refetch.
 * - Mismatched tables are refetched and re-verified (reconcile), at most twice, then flagged loudly.
 */

export type HealthState = "ok" | "healing" | "repaired" | "degraded" | "blocked";

export interface TableSpec {
  /** database table */
  table: string;
  /** key on StoreData that holds its rows */
  key: string;
  /** column the app orders by when paging (a unique tie-breaker is added by the store) */
  order: string;
  /** columns that make a row unique (used to spot duplicated rows) */
  pk: string[];
  /** the app tolerates this table not existing yet (older database) */
  optional?: boolean;
  /** only the last LOG_WINDOW_DAYS days are loaded, filtered on `order` */
  windowed?: boolean;
  /** plain-English name for the banner */
  label: string;
}

/** Every table the store loads at startup. */
export const TABLES: TableSpec[] = [
  { table: "cost_venues", key: "venues", order: "sort", pk: ["id"], label: "Venues" },
  { table: "cost_settings", key: "rawSettings", order: "key", pk: ["key"], label: "Settings" },
  { table: "cost_targets", key: "targets", order: "venue_id", pk: ["venue_id", "category"], label: "GP targets" },
  { table: "cost_suppliers", key: "suppliers", order: "name", pk: ["id"], label: "Suppliers" },
  { table: "cost_ingredients", key: "ingredients", order: "name", pk: ["id"], label: "Ingredients" },
  { table: "cost_preps", key: "preps", order: "name", pk: ["id"], label: "Preps" },
  { table: "cost_menu_items", key: "items", order: "name", pk: ["id"], label: "Menu items" },
  { table: "cost_recipe_lines", key: "lines", order: "sort", pk: ["id"], label: "Recipe lines" },
  { table: "cost_price_log", key: "priceLogs", order: "changed_at", pk: ["id"], windowed: true, label: "Price history" },
  { table: "cost_specials", key: "specials", order: "id", pk: ["id"], label: "Specials" },
  { table: "cost_allowed_users", key: "allowedUsers", order: "email", pk: ["email"], label: "Sign in list" },
  { table: "cost_gelato_serves", key: "gelatoServes", order: "sort", pk: ["id"], optional: true, label: "Gelato serves" },
  { table: "cost_gelato_serve_lines", key: "gelatoServeLines", order: "sort", pk: ["id"], optional: true, label: "Gelato serve lines" },
  { table: "cost_beer_serves", key: "beerServes", order: "sort", pk: ["id"], optional: true, label: "Beer serves" },
  { table: "cost_beers", key: "beers", order: "name", pk: ["id"], optional: true, label: "Tap beers" },
  { table: "cost_beer_prices", key: "beerPrices", order: "beer_id", pk: ["id"], optional: true, label: "Beer prices" },
  { table: "cost_offers", key: "offers", order: "created_at", pk: ["id"], optional: true, label: "Offers" },
  { table: "cost_offer_lines", key: "offerLines", order: "sort", pk: ["id"], optional: true, label: "Offer lines" },
  { table: "cost_ingredient_deals", key: "deals", order: "created_at", pk: ["id"], optional: true, label: "Supplier deals" },
];

const SPEC_BY_TABLE = new Map(TABLES.map((t) => [t.table, t]));
export function tableLabel(table: string): string {
  return SPEC_BY_TABLE.get(table)?.label ?? table;
}

// ---------------------------------------------------------------- errors

/** A failed table fetch, keeping the Postgres / PostgREST code so callers can tell "missing" from "broken". */
export class FetchError extends Error {
  constructor(
    public table: string,
    message: string,
    public code?: string,
  ) {
    super(`${table}: ${message}`);
    this.name = "FetchError";
  }
}

const MISSING_CODES = new Set([
  "42P01", // undefined_table
  "42703", // undefined_column
  "42883", // undefined_function
  "PGRST205", // table not in the schema cache
  "PGRST204", // column not in the schema cache
  "PGRST202", // function not in the schema cache
]);

/**
 * True ONLY for "this table / column / function is not in the database (yet)" errors. Network failures, RLS
 * denials, timeouts and everything else return false and must never be swallowed.
 */
export function isSchemaMissingError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const { code, message } = e as { code?: unknown; message?: unknown };
  if (typeof code === "string" && MISSING_CODES.has(code)) return true;
  const m = typeof message === "string" ? message : "";
  return /relation .* does not exist|column .* does not exist|function .* does not exist|could not find the (table|function|'[^']+' column)/i.test(m);
}

// ---------------------------------------------------------------- fingerprint

export interface TableFingerprint {
  count: number;
  /** md5 of the table's rows as the database sees them; absent when only counts were available */
  hash?: string | null;
}
export interface RemoteFingerprint {
  generatedAt?: string;
  tables: Record<string, TableFingerprint>;
}

/** Validates the jsonb the database function returns. Returns null if it is not usable. */
export function parseFingerprint(raw: unknown): RemoteFingerprint | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const tables: Record<string, TableFingerprint> = {};
  for (const spec of TABLES) {
    const e = obj[spec.table] as { count?: unknown; hash?: unknown } | undefined;
    if (!e || typeof e !== "object") continue;
    const count = Number(e.count);
    if (!Number.isFinite(count) || count < 0) return null;
    tables[spec.table] = { count, hash: typeof e.hash === "string" ? e.hash : null };
  }
  if (Object.keys(tables).length === 0) return null;
  return { generatedAt: typeof obj.generated_at === "string" ? obj.generated_at : undefined, tables };
}

export interface TableMismatch {
  table: string;
  /** rows the app holds */
  loaded: number;
  /** rows the database has (-1 when the fetch itself failed) */
  expected: number;
  reason: "count" | "duplicate" | "error";
  message?: string;
}

function rowKey(spec: TableSpec, row: unknown): string {
  const r = row as Record<string, unknown>;
  return spec.pk.map((c) => String(r?.[c])).join("|");
}

function hasDuplicates(spec: TableSpec, rows: readonly unknown[]): boolean {
  const seen = new Set<string>();
  for (const r of rows) {
    const k = rowKey(spec, r);
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
}

/**
 * Compares what the app loaded with what the database says exists. Only tables present in both are compared.
 * Same count with duplicated keys is still a mismatch (rows dropped on one page and repeated on another).
 */
export function compareFingerprint(loadedRows: Record<string, readonly unknown[] | undefined>, remote: RemoteFingerprint): { ok: boolean; mismatches: TableMismatch[] } {
  const mismatches: TableMismatch[] = [];
  for (const spec of TABLES) {
    const rows = loadedRows[spec.table];
    const exp = remote.tables[spec.table];
    if (!rows || !exp) continue;
    if (rows.length !== exp.count) mismatches.push({ table: spec.table, loaded: rows.length, expected: exp.count, reason: "count" });
    else if (hasDuplicates(spec, rows)) mismatches.push({ table: spec.table, loaded: rows.length, expected: exp.count, reason: "duplicate" });
  }
  return { ok: mismatches.length === 0, mismatches };
}

/** Tables whose database content differs between two fingerprints (someone else changed them, or our own write). */
export function changedTables(prev: RemoteFingerprint, next: RemoteFingerprint): string[] {
  const out: string[] = [];
  for (const spec of TABLES) {
    const a = prev.tables[spec.table];
    const b = next.tables[spec.table];
    if (!a || !b) continue;
    if (a.count !== b.count || (a.hash != null && b.hash != null && a.hash !== b.hash)) out.push(spec.table);
  }
  return out;
}

/** Every table is empty for someone who is signed in: row level security is hiding the data, or the session ended. */
export function isBlocked(remote: RemoteFingerprint | null): boolean {
  if (!remote) return false;
  const counts = Object.values(remote.tables);
  return counts.length > 0 && counts.every((t) => t.count === 0);
}

// ---------------------------------------------------------------- health state

export interface Health {
  state: HealthState;
  mismatches: TableMismatch[];
  /** ISO time of the last check that found everything consistent */
  lastVerifiedAt: string | null;
  message: string | null;
  /** true when the check itself could not run (nothing was compared) */
  unverified?: boolean;
}

export const MSG_DEGRADED = "Some data didn’t load completely, so costs and margins may be wrong.";
export const MSG_UNVERIFIED = "We couldn’t confirm your data loaded completely, so costs and margins may be wrong.";
export const MSG_BLOCKED = "You do not have access to this data";

export function initialHealth(): Health {
  return { state: "healing", mismatches: [], lastVerifiedAt: null, message: null };
}

/** "2:14pm" in Brisbane time. */
export function formatVerifiedTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Australia/Brisbane" })
    .format(d)
    .replace(/\s/g, "")
    .toLowerCase();
}

// ---------------------------------------------------------------- revalidation policy

export const WRITE_SETTLE_MS = 8_000; // wait this long after the user's last write
export const WRITE_MIN_GAP_MS = 30_000; // never check more than once per 30s because of writes
export const FOCUS_STALE_MS = 2 * 60_000; // returning to the tab: check if the last check is older than this
export const PERIODIC_STALE_MS = 3 * 60_000; // while visible: check every 3 minutes

/**
 * Milliseconds until the check that follows the user's last write is allowed (>= 0), or null if the last
 * write has already been covered by a check.
 */
export function writeCheckDelay(lastCheckAt: number | null, lastWriteAt: number | null, now: number): number | null {
  if (lastWriteAt == null) return null;
  if (lastCheckAt != null && lastCheckAt >= lastWriteAt) return null; // a check already ran after that write
  const settle = WRITE_SETTLE_MS - (now - lastWriteAt);
  const gap = lastCheckAt == null ? 0 : WRITE_MIN_GAP_MS - (now - lastCheckAt);
  return Math.max(0, settle, gap);
}

/**
 * Should a background check run now? Never while the tab is hidden. A write that no check has covered yet
 * is due after it settles (8s) and 30s since the last check; otherwise a check is due once the last one
 * is older than staleMs.
 */
export function shouldRevalidate(lastCheckAt: number | null, lastWriteAt: number | null, now: number, hidden: boolean, staleMs: number = FOCUS_STALE_MS): boolean {
  if (hidden) return false;
  const pending = writeCheckDelay(lastCheckAt, lastWriteAt, now);
  if (pending != null) return pending === 0;
  if (lastCheckAt == null) return true;
  return now - lastCheckAt >= staleMs;
}

// ---------------------------------------------------------------- heal

export interface ReconcileInput {
  /** rows by table name; the caller's copy is not mutated */
  rows: Record<string, unknown[]>;
  /** the fingerprint taken alongside the load; null when it could not be obtained */
  remote: RemoteFingerprint | null;
  /** tables to refetch whatever the comparison says (their first fetch failed, or their content changed) */
  force?: string[];
  refetch: (table: string) => Promise<unknown[]>;
  /** a fresh fingerprint, used to re-verify after a refetch */
  remeasure: () => Promise<RemoteFingerprint | null>;
  maxAttempts?: number;
  /** called once, when the first mismatch is found and healing starts */
  onHealing?: (mismatches: TableMismatch[]) => void;
}

export interface ReconcileResult {
  rows: Record<string, unknown[]>;
  remote: RemoteFingerprint | null;
  /** still wrong after healing (empty when fine) */
  mismatches: TableMismatch[];
  /** tables that were refetched at least once */
  refetched: string[];
  /** number of heal rounds run */
  attempts: number;
  /** the comparison could not run at all */
  unverified: boolean;
}

/**
 * Verify, and if needed heal: refetch just the mismatched tables (one after another), re-verify against a fresh
 * fingerprint, up to maxAttempts (2) rounds. A table that keeps failing stays in `mismatches`.
 */
export async function reconcile(input: ReconcileInput): Promise<ReconcileResult> {
  const max = input.maxAttempts ?? 2;
  const rows: Record<string, unknown[]> = { ...input.rows };
  let remote = input.remote;
  const refetched = new Set<string>();
  const errors = new Map<string, TableMismatch>();
  const force = new Set(input.force ?? []);

  const current = (): TableMismatch[] => {
    // a table whose fetch failed is reported as an error (its rows are only a stand-in), not as a count mismatch
    const out: TableMismatch[] = [...errors.values()];
    if (remote) for (const m of compareFingerprint(rows, remote).mismatches) if (!errors.has(m.table)) out.push(m);
    return out;
  };

  let mism = current();
  let attempts = 0;
  let announced = false;
  while ((mism.length > 0 || force.size > 0) && attempts < max) {
    if (!announced && mism.length > 0) {
      announced = true;
      input.onHealing?.(mism);
    }
    attempts++;
    const todo = new Set<string>([...mism.map((m) => m.table), ...force]);
    force.clear();
    for (const table of todo) {
      try {
        rows[table] = await input.refetch(table);
        errors.delete(table);
        refetched.add(table);
      } catch (e) {
        errors.set(table, { table, loaded: rows[table]?.length ?? 0, expected: -1, reason: "error", message: e instanceof Error ? e.message : String(e) });
      }
    }
    try {
      remote = (await input.remeasure()) ?? remote;
    } catch {
      /* keep the previous fingerprint */
    }
    mism = current();
  }
  return { rows, remote, mismatches: mism, refetched: [...refetched], attempts, unverified: !remote };
}
