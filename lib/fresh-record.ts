import type { SupabaseClient } from "@supabase/supabase-js";
import type { Fresh } from "./edit-conflict";
import type { MenuItem, Prep, RecipeLine } from "./types";

/**
 * Reads, straight from the database, the one dish or prep the editor is saving and its ingredient lines: one request per
 * table, in parallel. Used at Save time so the check compares against what is stored now, not against what the page
 * loaded minutes ago. Any error is thrown (the caller treats it as a failed save and never writes blind).
 *
 * `select("*")` on purpose: before the edit stamps migration the row simply has no updated_by, and the caller carries on
 * with the content comparison alone.
 */
export type RecordKind = "item" | "prep";

export const RECORD_TABLE: Record<RecordKind, string> = { item: "cost_menu_items", prep: "cost_preps" };

export async function fetchFreshRecord<R extends MenuItem | Prep>(sb: SupabaseClient, kind: RecordKind, id: string): Promise<Fresh<R>> {
  const [rowRes, linesRes] = await Promise.all([
    sb.from(RECORD_TABLE[kind]).select("*").eq("id", id),
    sb.from("cost_recipe_lines").select("*").eq("parent_type", kind).eq("parent_id", id).order("sort", { ascending: true }),
  ]);
  if (rowRes.error) throw new Error(rowRes.error.message);
  if (linesRes.error) throw new Error(linesRes.error.message);
  const rows = (rowRes.data as R[] | null) ?? [];
  const lines = ((linesRes.data as RecipeLine[] | null) ?? []).map((l) => ({ ...l, qty: Number(l.qty) || 0 }));
  return { row: rows[0] ?? null, lines };
}

/**
 * The field update, with the optimistic guard: when the row has an updated_at, the update only lands if the row still
 * has the value the fresh read saw, so two saves in the same second cannot both pass the check. Returns the stored row, or
 * null when nothing matched (`stale` then says whether the guard was the reason). Best effort: it protects the row, not the
 * recipe lines, which are written afterwards as a delete plus an upsert.
 */
export async function guardedUpdate<R extends object>(
  sb: SupabaseClient,
  kind: RecordKind,
  id: string,
  patch: object,
  guard: string | null,
): Promise<{ row: R | null; stale: boolean }> {
  let q = sb.from(RECORD_TABLE[kind]).update(patch).eq("id", id);
  if (guard) q = q.eq("updated_at", guard);
  const { data, error } = await q.select("*");
  if (error) throw new Error(error.message);
  const rows = (data as R[] | null) ?? [];
  if (rows.length === 0) return { row: null, stale: !!guard };
  return { row: rows[0], stale: false };
}
