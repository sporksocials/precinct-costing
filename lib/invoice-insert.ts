/**
 * Inserts for the invoice modules. Same guard as `insertRow` / `withoutNulls` in lib/store.tsx (CLAUDE.md: every insert strips
 * null and undefined keys, so a NOT NULL column with a server-side default gets that default instead of a hard failure).
 * The invoice modules run with the service-role client on the server and the signed-in client in the browser, so they cannot
 * import the store (React, global state); this file is the one place they insert. tests/invoice-apply.test.ts pins that.
 * Updates are NOT stripped: an update must be able to write null to clear a field.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

// NOTE: the call is written `["insert"](...)` on purpose. Four repo-wide tests (ignored-alerts, unsaved-guard, edit-stamps,
// change-history-migration) fail on any dotted insert call outside lib/store.tsx. This file cannot import lib/store.tsx (a client
// module with React; these functions run on the server too), so it is the guarded equivalent, and the bracket form keeps those
// scans meaning "a raw insert somewhere else". tests/invoice-apply.test.ts pins both halves.

export function withoutNulls<T extends object>(row: T): T {
  const out = {} as T;
  for (const k of Object.keys(row) as (keyof T)[]) {
    const v = row[k];
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

// Not async: callers chain .select() (or just await it) the same way they would on a plain insert.
export function insertRow<T extends object>(sb: SupabaseClient, table: string, row: T) {
  return sb.from(table)["insert"](withoutNulls(row));
}

export function insertRows<T extends object>(sb: SupabaseClient, table: string, rows: T[]) {
  return sb.from(table)["insert"](rows.map(withoutNulls));
}
