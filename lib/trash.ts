/**
 * Trash: records that were deleted and are not back, found from cost_change_history (read only here, pure functions).
 *
 * How a deleted record is found: a history row with op = 'delete' on one of the RESTORABLE parent tables whose row_key is
 * no longer in the live table. When a record was deleted more than once (restored, then deleted again) only the latest
 * delete counts. Nothing is ever purged by the app.
 *
 * How its children are found: each child table (recipe lines, beer prices, gelato serve lines, offer lines) writes delete
 * rows with parent_table / parent_id pointing at the parent. The app deletes recipe lines first and the parent in a
 * separate request a moment later; a database cascade deletes the children inside the parent's own transaction. So the
 * children are the child delete rows for the SAME parent within TRASH_BEFORE_MS before the parent's delete up to
 * TRASH_AFTER_MS after it. If those rows carry transaction ids, only the latest transaction group is used (plus any row
 * sharing the parent's own transaction), so a line removed in an ordinary editor save earlier the same morning is not
 * pulled back in with the dish.
 */
import { brisbaneDayLabel, brisbaneTime } from "./change-log";
import type { HistoryRow } from "./change-history";

export type Row = Record<string, unknown>;

/** child delete rows count from this long before the parent's delete ... */
export const TRASH_BEFORE_MS = 10 * 60_000;
/** ... up to this long after it */
export const TRASH_AFTER_MS = 60_000;

export interface ChildSpec {
  table: string;
  /** word for the sheet, singular and plural ("ingredient line") */
  noun: string;
  /** column on the child row that holds the parent's key */
  fk: string;
  /** recipe lines share one table between dishes and preps: the parent_type value that selects this parent's lines */
  parentType?: "item" | "prep";
  /** how the child references other records that must still exist: column, table it points at, optional guard column */
  refs: { column: string; table: string; when?: (row: Row) => boolean }[];
}

export interface RestorableSpec {
  table: string;
  /** key in StoreData for this table's live rows */
  storeKey: string;
  /** columns that must be unique together (the database refuses a clash) */
  unique?: string[];
  children: ChildSpec[];
  /** records the PARENT row points at that must still exist, or the restore is refused */
  refs: { column: string; table: string; word: string }[];
  /** where the restored record can be opened */
  href: (id: string) => string;
}

const RECIPE_REFS: ChildSpec["refs"] = [
  { column: "component_id", table: "cost_ingredients", when: (r) => r.component_type !== "prep" },
  { column: "component_id", table: "cost_preps", when: (r) => r.component_type === "prep" },
];

/** The registry: parent table to its restorable children and what must exist. One place, so Trash, tests and the demo agree. */
export const RESTORABLE: Record<string, RestorableSpec> = {
  cost_menu_items: {
    table: "cost_menu_items",
    storeKey: "items",
    unique: ["name", "venue_id"],
    children: [{ table: "cost_recipe_lines", noun: "ingredient line", fk: "parent_id", parentType: "item", refs: RECIPE_REFS }],
    refs: [],
    href: (id) => `/items/${id}`,
  },
  cost_preps: {
    table: "cost_preps",
    storeKey: "preps",
    unique: ["name", "venue_id"],
    children: [{ table: "cost_recipe_lines", noun: "ingredient line", fk: "parent_id", parentType: "prep", refs: RECIPE_REFS }],
    refs: [],
    href: (id) => `/preps/${id}`,
  },
  cost_beers: {
    table: "cost_beers",
    storeKey: "beers",
    unique: ["venue_id", "name"],
    children: [{ table: "cost_beer_prices", noun: "serve price", fk: "beer_id", refs: [{ column: "serve_id", table: "cost_beer_serves" }] }],
    refs: [{ column: "ingredient_id", table: "cost_ingredients", word: "keg ingredient" }],
    href: (id) => `/beers/${id}`,
  },
  cost_gelato_serves: {
    table: "cost_gelato_serves",
    storeKey: "gelatoServes",
    unique: ["venue_id", "name"],
    children: [{ table: "cost_gelato_serve_lines", noun: "ingredient line", fk: "serve_id", refs: [{ column: "ingredient_id", table: "cost_ingredients" }] }],
    refs: [],
    href: () => "/gelato/serves",
  },
  cost_offers: {
    table: "cost_offers",
    storeKey: "offers",
    children: [
      {
        table: "cost_offer_lines",
        noun: "item line",
        fk: "offer_id",
        refs: [
          { column: "item_id", table: "cost_menu_items" },
          { column: "beer_id", table: "cost_beers" },
          { column: "serve_id", table: "cost_beer_serves" },
        ],
      },
    ],
    refs: [],
    href: () => "/menu",
  },
  cost_ingredient_deals: {
    table: "cost_ingredient_deals",
    storeKey: "deals",
    children: [],
    refs: [{ column: "ingredient_id", table: "cost_ingredients", word: "ingredient" }],
    href: (id) => `/ingredients?deal=${id}`,
  },
};

export const RESTORABLE_TABLES = Object.keys(RESTORABLE);

/* ------------------------------------------------------------------ what a record is called */

const DRINK_CATEGORIES = new Set(["Cocktail", "Mocktail", "Tap Beer", "Packaged Beer & Cider", "Wine", "Spirits", "RTD"]);
export type TrashType = "Drink" | "Dish" | "Gelato Item" | "Menu Item" | "Prep" | "Tap Beer" | "Serve" | "Offer" | "Deal";
export const TRASH_TYPES: TrashType[] = ["Drink", "Dish", "Gelato Item", "Prep", "Tap Beer", "Serve", "Offer", "Deal"];

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));

export function typeOf(table: string, row: Row): TrashType {
  switch (table) {
    case "cost_menu_items": {
      const c = str(row.category);
      return c === "Food" ? "Dish" : c === "Gelato" ? "Gelato Item" : DRINK_CATEGORIES.has(c) ? "Drink" : "Menu Item";
    }
    case "cost_preps": return "Prep";
    case "cost_beers": return "Tap Beer";
    case "cost_gelato_serves": return "Serve";
    case "cost_offers": return "Offer";
    default: return "Deal";
  }
}

/** Display name; a deal has none of its own, so it is named after its ingredient. */
export function nameOfRow(table: string, row: Row, ingredientName?: (id: string) => string | undefined): string {
  if (table === "cost_ingredient_deals") return `${ingredientName?.(str(row.ingredient_id)) ?? "An ingredient"} deal`;
  return str(row.name) || "Unnamed";
}

/* ------------------------------------------------------------------ finding deleted records */

export interface TrashEntry {
  /** the parent's delete history row id (unique per entry) */
  id: string;
  table: string;
  key: string;
  name: string;
  type: TrashType;
  venueId: number | null;
  /** the whole row as it was when deleted */
  row: Row;
  deletedBy: string | null;
  deletedAt: string;
  /** child delete rows that came with it, by child table */
  children: { spec: ChildSpec; rows: HistoryRow[] }[];
  /** total child rows */
  childCount: number;
}

const ms = (s: string): number => {
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? 0 : t;
};

/** The child delete rows that belong to one parent delete (see the file header). Newest per child row; no duplicates. */
export function childrenOfDelete(parent: HistoryRow, spec: ChildSpec, childDeletes: readonly HistoryRow[]): HistoryRow[] {
  const at = ms(parent.changed_at);
  const mine = childDeletes.filter((c) => {
    if (c.op !== "delete" || c.table_name !== spec.table || c.parent_id !== parent.row_key || c.parent_table !== parent.table_name) return false;
    if (spec.parentType && c.old_row && c.old_row.parent_type !== spec.parentType) return false;
    const t = ms(c.changed_at);
    const sameTx = parent.tx_id != null && c.tx_id != null && String(parent.tx_id) === String(c.tx_id);
    return sameTx || (t >= at - TRASH_BEFORE_MS && t <= at + TRASH_AFTER_MS);
  });
  // rows carrying transaction ids: keep the latest group (the "delete all lines" statement) and the parent's own transaction
  const withTx = mine.filter((c) => c.tx_id != null);
  let kept = mine;
  if (withTx.length === mine.length && mine.length) {
    const own = parent.tx_id != null ? String(parent.tx_id) : null;
    const latest = [...mine].filter((c) => String(c.tx_id) !== own).sort((a, b) => ms(b.changed_at) - ms(a.changed_at) || Number(b.id) - Number(a.id))[0];
    kept = mine.filter((c) => String(c.tx_id) === own || (latest && String(c.tx_id) === String(latest.tx_id)));
  }
  const byKey = new Map<string, HistoryRow>();
  for (const c of kept) {
    const prev = byKey.get(c.row_key);
    if (!prev || ms(c.changed_at) > ms(prev.changed_at) || (ms(c.changed_at) === ms(prev.changed_at) && Number(c.id) > Number(prev.id))) byKey.set(c.row_key, c);
  }
  return [...byKey.values()].sort((a, b) => Number(a.old_row?.sort ?? 0) - Number(b.old_row?.sort ?? 0) || Number(a.id) - Number(b.id));
}

/**
 * Deleted records that are still deleted. `isLive(table, key)` says whether the key exists in the live table now.
 * Newest delete first.
 */
export function buildTrash(rows: readonly HistoryRow[], isLive: (table: string, key: string) => boolean, ingredientName?: (id: string) => string | undefined): TrashEntry[] {
  const deletes = rows.filter((r) => r.op === "delete");
  const latest = new Map<string, HistoryRow>();
  for (const r of deletes) {
    if (!RESTORABLE[r.table_name] || !r.old_row) continue;
    const k = `${r.table_name}|${r.row_key}`;
    const prev = latest.get(k);
    if (!prev || ms(r.changed_at) > ms(prev.changed_at) || (ms(r.changed_at) === ms(prev.changed_at) && Number(r.id) > Number(prev.id))) latest.set(k, r);
  }
  const childDeletes = deletes.filter((r) => !RESTORABLE[r.table_name] && r.parent_table && r.parent_id);
  const out: TrashEntry[] = [];
  for (const r of latest.values()) {
    if (isLive(r.table_name, r.row_key)) continue; // already restored (or recreated)
    const spec = RESTORABLE[r.table_name];
    const row = r.old_row as Row;
    const children = spec.children.map((c) => ({ spec: c, rows: childrenOfDelete(r, c, childDeletes) }));
    out.push({
      id: String(r.id),
      table: r.table_name,
      key: r.row_key,
      name: nameOfRow(r.table_name, row, ingredientName),
      type: typeOf(r.table_name, row),
      venueId: row.venue_id == null ? null : Number(row.venue_id),
      row,
      deletedBy: r.changed_by && r.changed_by.trim() ? r.changed_by.trim() : null,
      deletedAt: r.changed_at,
      children,
      childCount: children.reduce((n, c) => n + c.rows.length, 0),
    });
  }
  return out.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : a.deletedAt > b.deletedAt ? -1 : Number(b.id) - Number(a.id)));
}

/* ------------------------------------------------------------------ planning a restore */

/** What is in the live database right now, as the store holds it. */
export interface LiveView {
  has(table: string, key: string): boolean;
  rows(table: string): Row[];
}

export interface PlannedChild {
  table: string;
  /** the row as it was when deleted: original id and values */
  row: Row;
  label: string;
}
export interface SkippedChild {
  table: string;
  row: Row;
  label: string;
  reason: string;
}
export interface RestorePlan {
  entry: TrashEntry;
  /** set = nothing is written; this is the plain message for the sheet */
  blocker: string | null;
  /** true when the blocker is a name clash (the database would refuse it too) */
  clash: boolean;
  parentTable: string;
  parentRow: Row;
  children: PlannedChild[];
  skipped: SkippedChild[];
  headline: string;
  /** Research Notes are removed by the database with a dish or prep and are not kept in the history */
  researchNote: string | null;
}

export interface PlanLookups {
  venueName: (id: number) => string | undefined;
  /** a record's name, from the live store first and then from history (deleted records) */
  nameOf: (table: string, key: string) => string | undefined;
}

const WORD: Record<string, string> = { cost_ingredients: "ingredient", cost_preps: "prep", cost_menu_items: "dish or drink", cost_beers: "tap beer", cost_beer_serves: "serve" };
const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

function amountOf(table: string, row: Row): string {
  if (row.qty == null) return "";
  const q = Number(row.qty);
  if (!Number.isFinite(q)) return "";
  const unit = str(row.unit);
  return table === "cost_offer_lines" ? ` x ${q}` : ` ${Math.round(q * 1000) / 1000}${unit ? ` ${unit}` : ""}`;
}

function childLabel(table: string, row: Row, nameOf: PlanLookups["nameOf"]): string {
  let what = "A line";
  if (table === "cost_recipe_lines") what = nameOf(row.component_type === "prep" ? "cost_preps" : "cost_ingredients", str(row.component_id)) ?? (row.component_type === "prep" ? "A prep" : "An ingredient");
  else if (table === "cost_gelato_serve_lines") what = nameOf("cost_ingredients", str(row.ingredient_id)) ?? "An ingredient";
  else if (table === "cost_beer_prices") what = nameOf("cost_beer_serves", str(row.serve_id)) ?? "A serve";
  else if (table === "cost_offer_lines") what = str(row.item_id) ? nameOf("cost_menu_items", str(row.item_id)) ?? "A menu item" : str(row.beer_id) ? nameOf("cost_beers", str(row.beer_id)) ?? "A tap beer" : "An item";
  return `${what}${amountOf(table, row)}`;
}

/**
 * Works out exactly what a restore would write, before anything is written. Pure.
 *  - parent blocked (nothing is written): a name clash with a live record, or something the parent points at is gone
 *  - child rows whose ingredient, prep or serve no longer exists are listed in `skipped` and left out; the rest still come back
 * A null venue never clashes (the database treats nulls as different).
 */
export function planRestore(entry: TrashEntry, live: LiveView, lk: PlanLookups): RestorePlan {
  const spec = RESTORABLE[entry.table];
  const venue = entry.venueId != null ? lk.venueName(entry.venueId) : undefined;
  const withVenue = `${entry.name}${venue ? ` (${venue})` : ""}`;
  let blocker: string | null = null;
  let clash = false;

  if (live.has(entry.table, entry.key)) blocker = `${entry.name} is already back.`;

  if (!blocker && spec.unique) {
    const sameKey = (r: Row): boolean =>
      spec.unique!.every((c) => {
        const a = r[c];
        const b = entry.row[c];
        if (a == null || b == null) return false;
        return c === "name" ? str(a) === str(b) : String(a) === String(b);
      });
    if (live.rows(entry.table).some((r) => String(r.id) !== entry.key && sameKey(r))) {
      clash = true;
      blocker = `A ${entry.type.toLowerCase()} with this name already exists${venue ? ` at ${venue}` : ""}. Rename or remove it first, then restore.`;
    }
  }
  if (!blocker) {
    for (const ref of spec.refs) {
      const v = entry.row[ref.column];
      if (v != null && v !== "" && !live.has(ref.table, String(v))) {
        const n = lk.nameOf(ref.table, String(v));
        blocker = `The ${ref.word}${n ? ` ${n}` : ""} no longer exists, so ${entry.name} cannot be restored yet. Add it back first, then restore.`;
        break;
      }
    }
  }

  const children: PlannedChild[] = [];
  const skipped: SkippedChild[] = [];
  for (const group of entry.children) {
    for (const h of group.rows) {
      const row = (h.old_row ?? {}) as Row;
      const label = childLabel(group.spec.table, row, lk.nameOf);
      let reason: string | null = null;
      for (const ref of group.spec.refs) {
        if (ref.when && !ref.when(row)) continue;
        const v = row[ref.column];
        if (v == null || v === "") continue;
        if (!live.has(ref.table, String(v))) {
          reason = `${lk.nameOf(ref.table, String(v)) ?? `The ${WORD[ref.table] ?? "record"}`} no longer exists`;
          break;
        }
      }
      if (reason) skipped.push({ table: group.spec.table, row, label, reason });
      else children.push({ table: group.spec.table, row, label });
    }
  }
  const noun = spec.children[0]?.noun ?? "line";
  const headline = children.length ? `Restores ${withVenue} and its ${plural(children.length, noun)}.` : `Restores ${withVenue}.`;
  const researchNote = entry.table === "cost_menu_items" || entry.table === "cost_preps" ? "Any Research Notes it had were removed with it and are not restored." : null;
  return { entry, blocker, clash, parentTable: entry.table, parentRow: entry.row, children, skipped, headline, researchNote };
}

/* ------------------------------------------------------------------ the list on the Trash page */

export const TRASH_PAGE = 25;

/** "with 6 ingredient lines" (or "" when there are none) */
export function withChildren(entry: TrashEntry): string {
  if (!entry.childCount) return "";
  const noun = entry.children.find((c) => c.rows.length)?.spec.noun ?? "line";
  return `with ${plural(entry.childCount, noun)}`;
}

export function matchesTrash(e: TrashEntry, q: string, type: TrashType | "all", venueId: number | null): boolean {
  if (type !== "all" && e.type !== type) return false;
  if (venueId != null && e.venueId != null && e.venueId !== venueId) return false;
  const s = q.trim().toLowerCase();
  return !s || e.name.toLowerCase().includes(s) || e.type.toLowerCase().includes(s) || (e.deletedBy ?? "database").toLowerCase().includes(s);
}

/** "Mon 5 Oct, 2:14 pm" in Brisbane time */
export function deletedWhen(at: string): string {
  return `${brisbaneDayLabel(at)}, ${brisbaneTime(at)}`;
}

/** Who deleted it: the first name for a signed-in person, "Database" for direct database work. */
export function deletedByLabel(email: string | null, personName: (e: string | null | undefined) => string | null): string {
  return email ? personName(email) ?? email : "Database";
}
