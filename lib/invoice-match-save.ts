/**
 * Match Items: the save flow with renames. Save Matches saves the matches first (through answerItemGroups, with the pack
 * conversion in each note), THEN renames the ingredients the person chose to rename, and the names that follow them (dishes that
 * use the ingredient, ordering products linked to it: lib/rename-linked.ts, the same plan the single-ingredient rename uses).
 * A rename that fails is reported by name and never undoes a match. Undo puts every name back.
 *
 * The writing goes through functions handed in (`SaveDeps`): the screen passes the store's own updateIngredient and updateItem and
 * the ordering data layer's updateProduct, so history, edit stamps and offline behaviour are as ever; the tests pass fakes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ItemGroupAnswer, ItemGroupsResult } from "./invoice-answer";
import {
  planLinkedRenames,
  type LinkedDishRename,
  type LinkedItem,
  type LinkedLine,
  type LinkedProduct,
  type LinkedProductRename,
  type LinkedSkip,
} from "./rename-linked";

export interface PlannedRename {
  /** the item row this rename belongs to */
  key: string;
  ingredientId: string;
  from: string;
  to: string;
}

export interface BatchRenamePlan {
  ingredients: PlannedRename[];
  dishes: (LinkedDishRename & { key: string })[];
  products: (LinkedProductRename & { key: string; ingredientId: string })[];
  skipped: LinkedSkip[];
}

export const EMPTY_BATCH: BatchRenamePlan = { ingredients: [], dishes: [], products: [], skipped: [] };

/** How many names the batch changes besides the ingredients themselves. */
export const linkedCount = (p: BatchRenamePlan): number => p.dishes.length + p.products.length;

/**
 * The renames and everything named after them, worked out against the app as it is now. Each ingredient is planned on its own
 * with the same rules as a single rename; a dish or product two plans would both rename is renamed by the first only.
 */
export function planBatchRenames(input: {
  renames: readonly PlannedRename[];
  ingredients: readonly { id: string; name: string }[];
  items: readonly LinkedItem[];
  lines: readonly LinkedLine[];
  products: readonly LinkedProduct[];
}): BatchRenamePlan {
  const plan: BatchRenamePlan = { ingredients: [...input.renames], dishes: [], products: [], skipped: [] };
  const dishSeen = new Set<string>();
  const productSeen = new Set<string>();
  for (const r of input.renames) {
    const p = planLinkedRenames({ ingredientId: r.ingredientId, oldName: r.from, newName: r.to, ingredients: input.ingredients, items: input.items, lines: input.lines, products: input.products });
    for (const d of p.dishes) if (!dishSeen.has(d.id)) (dishSeen.add(d.id), plan.dishes.push({ ...d, key: r.key }));
    for (const pr of p.products) if (!productSeen.has(pr.id)) (productSeen.add(pr.id), plan.products.push({ ...pr, key: r.key, ingredientId: r.ingredientId }));
    plan.skipped.push(...p.skipped);
  }
  return plan;
}

/** The plan cut down to the rows whose match saved: a rename never runs for an item that did not save. */
export function onlyKeys(plan: BatchRenamePlan, keys: ReadonlySet<string>): BatchRenamePlan {
  return {
    ingredients: plan.ingredients.filter((r) => keys.has(r.key)),
    dishes: plan.dishes.filter((d) => keys.has(d.key)),
    products: plan.products.filter((p) => keys.has(p.key)),
    skipped: plan.skipped,
  };
}

/* ---------------------------------------------------------------- running it */

export interface SaveDeps {
  answer: (groups: ItemGroupAnswer[]) => Promise<ItemGroupsResult>;
  renameIngredient: (id: string, name: string) => Promise<void>;
  renameDish: (id: string, name: string) => Promise<void>;
  renameProduct: (id: string, patch: { name: string; ingredient_id?: string | null }) => Promise<void>;
}

/** What was changed, with the old values, so Undo Renames can put every name back. */
export interface RenameApplied {
  ingredients: { id: string; from: string }[];
  dishes: { id: string; from: string }[];
  products: { id: string; from: string; link: boolean }[];
}

export interface RenameFailure {
  what: string;
  message: string;
}

export interface MatchSaveOutcome {
  result: ItemGroupsResult;
  /** the item keys whose match is saved (now or before) */
  savedKeys: Set<string>;
  /** the item keys that did not save, with the reason */
  failedKeys: Map<string, string>;
  renamedIngredients: number;
  renamedLinked: number;
  renameFailures: RenameFailure[];
  applied: RenameApplied;
}

const reason = (e: unknown): string => (e instanceof Error && e.message ? e.message : "It could not be changed.");

/** Saves the matches, then the renames for the items that saved. `plan` null means "Only Save The Matches". */
export async function runMatchSave(deps: SaveDeps, input: { answers: { key: string; answer: ItemGroupAnswer }[]; plan: BatchRenamePlan | null }): Promise<MatchSaveOutcome> {
  const result = await deps.answer(input.answers.map((a) => a.answer));
  const savedKeys = new Set<string>();
  const failedKeys = new Map<string, string>();
  result.groups.forEach((g) => {
    const key = input.answers[g.index].key;
    if (g.status === "saved" || g.status === "already") savedKeys.add(key);
    else failedKeys.set(key, g.status === "partial" ? `Some lines on this item did not save. ${g.message}` : g.message || "That item did not save.");
  });

  const applied: RenameApplied = { ingredients: [], dishes: [], products: [] };
  const renameFailures: RenameFailure[] = [];
  if (input.plan) {
    const plan = onlyKeys(input.plan, savedKeys);
    // an ingredient whose own rename failed leaves the names that follow it alone
    const failedIng = new Set<string>();
    for (const r of plan.ingredients) {
      try {
        await deps.renameIngredient(r.ingredientId, r.to);
        applied.ingredients.push({ id: r.ingredientId, from: r.from });
      } catch (e) {
        failedIng.add(r.ingredientId);
        renameFailures.push({ what: r.from, message: reason(e) });
      }
    }
    for (const d of plan.dishes) {
      const owner = plan.ingredients.find((r) => r.key === d.key);
      if (owner && failedIng.has(owner.ingredientId)) continue;
      try {
        await deps.renameDish(d.id, d.to);
        applied.dishes.push({ id: d.id, from: d.from });
      } catch (e) {
        renameFailures.push({ what: d.from, message: reason(e) });
      }
    }
    for (const p of plan.products) {
      if (failedIng.has(p.ingredientId)) continue;
      try {
        await deps.renameProduct(p.id, p.link ? { name: p.to, ingredient_id: p.ingredientId } : { name: p.to });
        applied.products.push({ id: p.id, from: p.from, link: p.link });
      } catch (e) {
        renameFailures.push({ what: p.from, message: reason(e) });
      }
    }
  }
  return { result, savedKeys, failedKeys, renamedIngredients: applied.ingredients.length, renamedLinked: applied.dishes.length + applied.products.length, renameFailures, applied };
}

/** Puts every name from one save back, newest first is not needed: each record is independent. Reports what could not be restored. */
export async function undoRenames(deps: Pick<SaveDeps, "renameIngredient" | "renameDish" | "renameProduct">, applied: RenameApplied): Promise<{ restored: number; failed: RenameFailure[] }> {
  let restored = 0;
  const failed: RenameFailure[] = [];
  const attempt = async (what: string, run: () => Promise<void>) => {
    try {
      await run();
      restored++;
    } catch (e) {
      failed.push({ what, message: reason(e) });
    }
  };
  for (const p of applied.products) await attempt(p.from, () => deps.renameProduct(p.id, p.link ? { name: p.from, ingredient_id: null } : { name: p.from }));
  for (const d of applied.dishes) await attempt(d.from, () => deps.renameDish(d.id, d.from));
  for (const i of applied.ingredients) await attempt(i.from, () => deps.renameIngredient(i.id, i.from));
  return { restored, failed };
}

/** "Renamed 14 items and 9 linked names." (the clause for linked names is left out when there are none) */
export function renameSummary(o: Pick<MatchSaveOutcome, "renamedIngredients" | "renamedLinked">): string | null {
  if (o.renamedIngredients === 0) return null;
  const items = `${o.renamedIngredients} ${o.renamedIngredients === 1 ? "item" : "items"}`;
  const linked = o.renamedLinked > 0 ? ` and ${o.renamedLinked} linked ${o.renamedLinked === 1 ? "name" : "names"}` : "";
  return `Renamed ${items}${linked}.`;
}

/* ---------------------------------------------------------------- loading */

/** The ordering products, for the linked plan. A missing table or any failure gives none: the rename still works for dishes. */
export async function loadLinkedProducts(sb: SupabaseClient): Promise<LinkedProduct[]> {
  try {
    const { data, error } = await sb.from("ordering_products").select("id,venue_id,category_id,name,ingredient_id");
    if (error || !data) return [];
    return data as LinkedProduct[];
  } catch {
    return [];
  }
}

/**
 * For each ingredient, how many OTHER active suppliers have an item matched to it (the saved matches, not rejections). Used to
 * start "Keep Current Name" on when another supplier already points at the ingredient. A failure gives an empty map, which is the
 * permissive answer: every row then starts with the rename on, and the person still sees and confirms every name.
 */
export async function loadOtherSupplierCounts(sb: SupabaseClient, supplierId: string | null): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const sup = await sb.from("invoice_suppliers").select("id,active");
    const active = new Set<string>(((sup.data ?? []) as { id: string; active: boolean }[]).filter((s) => s.active !== false).map((s) => s.id));
    const maps = await sb.from("invoice_item_map").select("ingredient_id,supplier_id,rejected").eq("rejected", false);
    if (maps.error || !maps.data) return out;
    const by = new Map<string, Set<string>>();
    for (const m of maps.data as { ingredient_id: string | null; supplier_id: string; rejected: boolean }[]) {
      if (!m.ingredient_id || m.supplier_id === supplierId || !active.has(m.supplier_id)) continue;
      const set = by.get(m.ingredient_id) ?? new Set<string>();
      set.add(m.supplier_id);
      by.set(m.ingredient_id, set);
    }
    for (const [id, set] of by) out.set(id, set.size);
  } catch {
    // no table, no network: the map stays empty
  }
  return out;
}
