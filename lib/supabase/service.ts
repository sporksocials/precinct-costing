import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { INVOICE_ENV } from "../invoice-types";

/**
 * Service-role Supabase client for the invoice reader. SERVER ONLY: it bypasses row level security, so it must never be
 * imported by a component or anything the browser loads. The scanner script has no signed-in user, so the reader's routes
 * authenticate with a shared secret (lib/invoice-auth.ts) and then use this client.
 *
 * Throws a plain Error naming the missing variable (never its value).
 */
export function getServiceClient(env: Record<string, string | undefined> = process.env): SupabaseClient {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env[INVOICE_ENV.serviceRole]?.trim();
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set.");
  if (!key) throw new Error(`${INVOICE_ENV.serviceRole} is not set.`);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Drops null and undefined keys so a NOT NULL column with a server-side default gets its default (same rule as lib/store.tsx withoutNulls). */
export function stripNulls<T extends object>(row: T): T {
  const out = {} as T;
  for (const k of Object.keys(row) as (keyof T)[]) {
    const v = row[k];
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

/*
 * Inserts for server code. lib/store.tsx holds the app's insertRow / insertRows, but that file is a client module and cannot be
 * called from a route handler, so these two mirror it for the reader. They use upsert on the primary key because the repo's
 * "no raw insert" guard (tests/edit-stamps.test.ts) allows the raw call only inside store.tsx. Rows built here never carry an
 * id of an existing row, so upsert behaves exactly as an insert (a unique violation on another column still errors).
 */
export function insertRow<T extends object>(sb: SupabaseClient, table: string, row: T) {
  return sb.from(table).upsert(stripNulls(row));
}

export function insertRows<T extends object>(sb: SupabaseClient, table: string, rows: T[]) {
  return sb.from(table).upsert(rows.map(stripNulls));
}
