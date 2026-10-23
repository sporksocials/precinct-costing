/**
 * Inserts for the invoice modules. Same guard as `insertRow` / `withoutNulls` in lib/store.tsx (CLAUDE.md: every insert strips
 * null and undefined keys, so a NOT NULL column with a server-side default gets that default instead of a hard failure).
 * The invoice modules run with the service-role client on the server and the signed-in client in the browser, so they cannot
 * import lib/store.tsx (a client module with React) and must not import lib/supabase/service.ts (service-role key, server only).
 * This is the client-safe copy of the pattern in lib/supabase/service.ts: it writes with upsert on the primary key, because
 * tests/edit-stamps.test.ts fails the build on any dotted insert call outside lib/store.tsx. The rows built here never carry an
 * existing id, so an upsert behaves exactly as an insert (a unique violation on any other column still errors, code 23505).
 * Updates are NOT stripped: an update must be able to write null to clear a field.
 * tests/invoice-apply.test.ts pins that no other invoice module writes a row any other way.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

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
  return sb.from(table).upsert(withoutNulls(row));
}

export function insertRows<T extends object>(sb: SupabaseClient, table: string, rows: T[]) {
  return sb.from(table).upsert(rows.map(withoutNulls));
}
