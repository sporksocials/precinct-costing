import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildIndex, costItem, type ItemCost } from "@/lib/costing";
import { virtualItemId } from "@/lib/gelato";
import { catalogueGaps, checkCostGroups, checkCostRows, dealFeedRows, gpSummary, happyHourRows, missingPriceGroups, priceIncreases, staleIngredients, underTargetRows } from "@/lib/insights";
import {
  ALERT_KINDS,
  ALERT_KIND_LABEL,
  belowTargetEntry,
  belowTargetKey,
  buildIgnoredRow,
  catalogueGapEntry,
  checkCostEntry,
  checkCostKey,
  dealEntry,
  happyHourEntry,
  happyHourKey,
  ignoredByName,
  ignoredCheckItemIds,
  ignoredKeySet,
  ignoredWhen,
  missingPriceEntry,
  offerBelowTargetEntry,
  offerCheckEntry,
  openRows,
  priceRiseEntry,
  priceRiseKey,
  sortIgnored,
  splitRows,
  stalePriceEntry,
  stalePriceKey,
  withIgnored,
  withoutIgnored,
  IGNORE_UNAVAILABLE,
  type AlertEntry,
  type AlertKind,
} from "@/lib/ignored-alerts";
import { deleteIgnoredAlert, fetchIgnoredAlerts, insertIgnoredAlert, mergeRows, rowsFromData } from "@/lib/store";
import { TABLES } from "@/lib/health";
import { DEFAULT_SETTINGS, type IgnoredAlert, type Ingredient, type IngredientDeal, type MenuItem, type Offer, type PortalPrice, type PriceLog, type RecipeLine } from "@/lib/types";

/* ---------- builders ---------- */
const ing = (id: string, over: Partial<Ingredient> = {}): Ingredient =>
  ({ id, name: id, category: "Food", supplier_id: null, supplier_code: null, pack_size: 1, pack_unit: "kg", pack_price: 10, price_inc_gst: false, gst_free: false, rebate: 0, yield_pct: 1, venues: "All", active: true, last_price_update: null, previous_price: null, source: null, notes: null, updated_at: null, ...over }) as Ingredient;
const item = (id: string, over: Partial<MenuItem> = {}): MenuItem =>
  ({ id, name: id, venue_id: 1, category: "Food", section: null, portions: 1, sell_price_inc: 22, target_override: null, hh_price_inc: null, active: true, source: null, notes: null, ...over }) as MenuItem;
let n = 0;
const line = (parent: string, comp: string, qty: number, unit: RecipeLine["unit"] = "kg"): RecipeLine => {
  n += 1;
  return { id: `l${n}`, parent_type: "item", parent_id: parent, component_type: "ingredient", component_id: comp, qty, unit, note: null, sort: n };
};
function costAll(items: MenuItem[], ings: Ingredient[], lines: RecipeLine[]): Map<string, ItemCost> {
  const index = buildIndex(ings, [], lines);
  const cache = new Map();
  return new Map(items.map((i) => [i.id, costItem(i, index, DEFAULT_SETTINGS, [], cache)]));
}
const ignoredRow = (e: AlertEntry, over: Partial<IgnoredAlert> = {}): IgnoredAlert => ({ ...buildIgnoredRow(e, "troy@sporksocials.com.au", `id-${e.key}`, "2026-10-04T05:14:00Z"), ...over });

/* ---------- one real alert of every kind ---------- */
const NOW = Date.now();
const isoAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

const ings = [
  ing("beef", { name: "Beef", pack_price: 30, last_price_update: "2026-01-02T00:00:00Z" }), // stale, and used
  ing("oil", { name: "Oil", pack_price: 6, last_price_update: null }), // never checked
  ing("zero", { name: "Zero", pack_price: 0 }), // zero cost line -> check cost
  ing("gin", { name: "Gin", pack_price: 30, pack_unit: "L" }),
  ing("fish", { name: "Fish", pack_price: 8, supplier_code: "F1" }),
];
const items = [
  item("Burger", { sell_price_inc: 14 }), // below target
  item("Plate", { name: "Plate" }), // check cost (zero cost line)
  item("Gin Sour", { category: "Spirits", sell_price_inc: null }), // missing price
  item("Happy Burger", { hh_price_inc: 5 }), // happy hour below cost
  item("Oil Dish"),
];
const lines = [line("Burger", "beef", 0.3), line("Plate", "zero", 1), line("Gin Sour", "gin", 0.03, "L"), line("Happy Burger", "beef", 0.3), line("Oil Dish", "oil", 0.1)];
const costs = costAll(items, ings, lines);
const itemById = new Map(items.map((i) => [i.id, i]));
const plog = (id: number, ingredient_id: string, daysAgo: number, from: number, to: number): PriceLog => ({ id, ingredient_id, changed_at: isoAgo(daysAgo), old_price: from, new_price: to, source: null, entered_by: null, notes: null });
const ingMap = new Map(ings.map((i) => [i.id, i]));
const rises = (logs: PriceLog[]) => priceIncreases(logs, ingMap, lines, itemById, 0.05, null, 30, costs);

describe("alert keys: one real alert of every kind", () => {
  it("price_rise: the key includes the price log row, so a later, different rise is a new alert", () => {
    const first = rises([plog(11, "beef", 5, 24, 30)])[0];
    expect(priceRiseKey(first)).toBe("price_rise:beef:11");
    expect(priceRiseEntry(first)).toMatchObject({ kind: "price_rise", ref: "/ingredients/beef", title: "Beef +25%" });
    const later = rises([plog(11, "beef", 5, 24, 30), plog(12, "beef", 1, 30, 36)])[0];
    expect(priceRiseKey(later)).toBe("price_rise:beef:12");
    expect(priceRiseKey(later)).not.toBe(priceRiseKey(first));
  });

  it("below_target: item id plus the price in cents, so a changed price shows again", () => {
    const row = underTargetRows(costs.values()).find((r) => r.cost.item.id === "Burger")!;
    expect(belowTargetKey(row.cost)).toBe("below_target:Burger:1400");
    expect(belowTargetEntry(row, "Burger")).toEqual({ key: "below_target:Burger:1400", kind: "below_target", ref: "/items/Burger", title: "Burger" });
    const repriced = costAll([item("Burger", { sell_price_inc: 15 })], ings, lines).get("Burger")!;
    expect(belowTargetKey(repriced)).toBe("below_target:Burger:1500");
  });

  it("below_target: every flavour of one gelato serve is one alert (the serve's price)", () => {
    const a = { item: { id: virtualItemId("Banana Gelato Mix", "cup") }, sellInc: 6 } as ItemCost;
    const b = { item: { id: virtualItemId("Mango Gelato Mix", "cup") }, sellInc: 6 } as ItemCost;
    const other = { item: { id: virtualItemId("Banana Gelato Mix", "waffle") }, sellInc: 6 } as ItemCost;
    expect(belowTargetKey(a)).toBe("below_target:gelato-serve:cup:600");
    expect(belowTargetKey(b)).toBe(belowTargetKey(a));
    expect(belowTargetKey(other)).not.toBe(belowTargetKey(a));
  });

  it("check_cost: one key per item, per tap beer, and per set of identical gelato warnings; digits in a warning do not matter", () => {
    const groups = checkCostGroups(checkCostRows(costs.values()));
    const plate = groups.find((g) => g.id === "Plate")!;
    expect(checkCostKey(plate)).toBe(`check_cost:Plate:${plate.warnings.map((w) => w.replace(/\d+/g, "#")).join("|")}`);
    expect(checkCostEntry(plate)).toMatchObject({ kind: "check_cost", ref: "/items/Plate", title: "Plate" });
    const g = (id: string, warnings: string[]) => ({ id, warnings });
    expect(checkCostKey(g("beer:b1", ["No keg linked to this beer"]))).toBe("check_cost:beer:b1:No keg linked to this beer");
    expect(checkCostKey(g("gelato:x", ["Zero cost line, Cream: pack price is 0"]))).toBe("check_cost:gelato:Zero cost line, Cream: pack price is #");
    expect(checkCostKey(g("a", ["GP is 95%, check the recipe cost"]))).toBe(checkCostKey(g("a", ["GP is 94%, check the recipe cost"])));
    expect(checkCostKey(g("a", ["GP is 95%, check the recipe cost"]))).not.toBe(checkCostKey(g("a", ["GP is 95%, check the recipe cost", "Portions is 0 or blank, costed as 1 portion"])));
  });

  it("missing_price: the group id (item, beer or gelato serve)", () => {
    const m = missingPriceGroups(costs.values())[0];
    expect(missingPriceEntry(m)).toEqual({ key: "missing_price:Gin Sour", kind: "missing_price", ref: "/items/Gin Sour", title: "Gin Sour" });
    expect(missingPriceEntry({ ...m, id: "gelato:cup", count: 3, name: "Cup", href: "/gelato/serves" })).toMatchObject({ key: "missing_price:gelato:cup", title: "Cup (3 serves)" });
  });

  it("happy_hour: the happy hour price, plus ':loss' once it is below cost", () => {
    const h = happyHourRows(costs.values())[0];
    expect(h.cost.item.id).toBe("Happy Burger");
    expect(h.belowCost).toBe(true);
    expect(happyHourKey(h)).toBe("happy_hour:Happy Burger:500:loss");
    expect(happyHourKey({ ...h, belowCost: false })).toBe("happy_hour:Happy Burger:500");
    expect(happyHourEntry(h)).toMatchObject({ kind: "happy_hour", ref: "/items/Happy Burger" });
  });

  it("stale_price: the ingredient and the date it was last checked (or 'never')", () => {
    const inUse = new Set(["beef", "oil"]);
    const stale = staleIngredients(ings, inUse);
    expect(stale.map(stalePriceKey).sort()).toEqual(["stale_price:beef:2026-01-02", "stale_price:oil:never"]);
    expect(stalePriceEntry(stale.find((i) => i.id === "beef")!)).toEqual({ key: "stale_price:beef:2026-01-02", kind: "stale_price", ref: "/ingredients/beef", title: "Beef" });
    // checking the price and letting it go stale again is a different alert
    expect(stalePriceKey({ id: "beef", last_price_update: "2026-04-05T00:00:00Z" })).not.toBe(stalePriceKey(stale.find((i) => i.id === "beef")!));
  });

  it("catalogue_gap: the ingredient and the catalogue price", () => {
    const portal = [{ supplier: "PFD", description: "Fish", product_code: "F1", uom: "1kg", price: 10, price_inc_gst: false, captured_at: "2026-10-01T00:00:00Z" } as PortalPrice];
    const suppliers = new Map([[1, { name: "PFD" }]]);
    const gaps = catalogueGaps([ing("fish", { supplier_id: 1, supplier_code: "F1", pack_price: 8 })], portal, 0.1, suppliers);
    expect(gaps).toHaveLength(1);
    expect(catalogueGapEntry(gaps[0])).toEqual({ key: "catalogue_gap:fish:10", kind: "catalogue_gap", ref: "/ingredients/fish", title: "fish" });
    const newer = catalogueGaps([ing("fish", { supplier_id: 1, supplier_code: "F1", pack_price: 8 })], [{ ...portal[0], price: 11 }], 0.1, suppliers);
    expect(catalogueGapEntry(newer[0]).key).toBe("catalogue_gap:fish:11");
  });

  it("deal_ending and deal_expired: the deal and its end date (an extended deal is a new alert)", () => {
    const deal = (id: string, ends_on: string): IngredientDeal =>
      ({ id, ingredient_id: "beef", kind: "special_price", buy_qty: null, free_qty: null, min_qty: null, pct_off: null, unit_price: null, special_pack_price: 20, starts_on: null, ends_on, note: null, active: true }) as IngredientDeal;
    const rows = dealFeedRows([deal("d1", "2026-10-08"), deal("d2", "2026-09-30")], ings, new Set(["beef"]), "2026-10-04");
    const ending = rows.find((r) => r.kind === "deal_ending")!;
    const expired = rows.find((r) => r.kind === "deal_expired")!;
    expect(dealEntry(ending)).toEqual({ key: "deal_ending:d1:2026-10-08", kind: "deal_ending", ref: "/ingredients/beef", title: "Beef" });
    expect(dealEntry(expired).key).toBe("deal_expired:d2:2026-09-30");
    expect(dealEntry({ ...ending, deal: { ...ending.deal, ends_on: "2026-10-20" } }).key).not.toBe(dealEntry(ending).key);
  });

  it("offer_below_target and offer_check: the offer (and its price for the first)", () => {
    const o = { id: "o1", name: "Taco Tuesday", price_inc: 18.5 } as Offer;
    expect(offerBelowTargetEntry(o)).toEqual({ key: "offer_below_target:o1:1850", kind: "offer_below_target", ref: "/specials/o1", title: "Taco Tuesday" });
    expect(offerBelowTargetEntry({ ...o, price_inc: 19 }).key).not.toBe(offerBelowTargetEntry(o).key);
    expect(offerCheckEntry(o)).toEqual({ key: "offer_check:o1", kind: "offer_check", ref: "/specials/o1", title: "Taco Tuesday" });
  });

  it("every alert kind has a label, and every entry builder is covered above", () => {
    expect(new Set(ALERT_KINDS).size).toBe(ALERT_KINDS.length);
    const covered: Record<AlertKind, true> = {
      price_rise: true,
      below_target: true,
      check_cost: true,
      missing_price: true,
      happy_hour: true,
      stale_price: true,
      catalogue_gap: true,
      deal_ending: true,
      deal_expired: true,
      offer_below_target: true,
      offer_check: true,
    };
    expect([...ALERT_KINDS].sort()).toEqual(Object.keys(covered).sort());
    for (const k of ALERT_KINDS) expect(ALERT_KIND_LABEL[k]).toBeTruthy();
  });
});

describe("open and ignored", () => {
  const entries: AlertEntry[] = [
    { key: "below_target:A:1000", kind: "below_target", ref: "/items/A", title: "A" },
    { key: "below_target:B:1000", kind: "below_target", ref: "/items/B", title: "B" },
    { key: "stale_price:C:never", kind: "stale_price", ref: "/ingredients/C", title: "C" },
  ];
  const keyOf = (e: AlertEntry) => e.key;

  it("with nothing ignored every alert is open", () => {
    expect(openRows(entries, keyOf, ignoredKeySet([]))).toEqual(entries);
  });

  it("ignoring one removes only that one from Open and lists it under Ignored", () => {
    const ignored = ignoredKeySet([ignoredRow(entries[1])]);
    const { open, ignored: hidden } = splitRows(entries, keyOf, ignored);
    expect(open.map((e) => e.title)).toEqual(["A", "C"]);
    expect(hidden.map((e) => e.title)).toEqual(["B"]);
  });

  it("a changed situation is a different key, so it is open again even though the old one is ignored", () => {
    const ignored = ignoredKeySet([ignoredRow(entries[0])]);
    const repriced: AlertEntry = { ...entries[0], key: "below_target:A:1100" };
    expect(openRows([repriced], keyOf, ignored)).toEqual([repriced]);
  });

  it("restore puts the alert back", () => {
    let list: IgnoredAlert[] = [];
    list = withIgnored(list, ignoredRow(entries[1]));
    expect(openRows(entries, keyOf, ignoredKeySet(list)).map((e) => e.title)).toEqual(["A", "C"]);
    list = withoutIgnored(list, entries[1].key);
    expect(list).toEqual([]);
    expect(openRows(entries, keyOf, ignoredKeySet(list)).map((e) => e.title)).toEqual(["A", "B", "C"]);
  });

  it("ignoring the same alert twice keeps one row; restoring one that is not there changes nothing", () => {
    const r = ignoredRow(entries[0]);
    expect(withIgnored(withIgnored([], r), { ...r, id: "other" })).toHaveLength(1);
    expect(withoutIgnored([r], "nope")).toEqual([r]);
  });

  it("the Ignored list is newest first and says who and when", () => {
    const older = ignoredRow(entries[0], { ignored_at: "2026-10-01T00:00:00Z" });
    const newer = ignoredRow(entries[1], { ignored_at: "2026-10-04T05:14:00Z" });
    expect(sortIgnored([older, newer]).map((r) => r.title)).toEqual(["B", "A"]);
    expect(ignoredByName("troy@sporksocials.com.au")).toBe("troy");
    expect(ignoredByName(null)).toBe("Someone");
    // 05:14 UTC is 3:14pm in Brisbane
    expect(ignoredWhen("2026-10-04T05:14:00Z", new Date("2026-10-05T00:00:00Z"))).toBe("4 Oct, 3:14pm");
    expect(ignoredWhen("2025-06-01T02:00:00Z", new Date("2026-10-05T00:00:00Z"))).toBe("1 Jun 2025, 12:00pm");
    expect(ignoredWhen(null)).toBe("");
  });

  it("buildIgnoredRow keeps what the Ignored list needs", () => {
    expect(buildIgnoredRow(entries[0], "troy@x.au", "id1", "2026-10-04T00:00:00Z")).toEqual({
      id: "id1",
      alert_key: "below_target:A:1000",
      kind: "below_target",
      ref: "/items/A",
      title: "A",
      ignored_by: "troy@x.au",
      ignored_at: "2026-10-04T00:00:00Z",
    });
  });
});

describe("counts leave out ignored alerts", () => {
  it("below target: an ignored dish is not counted (venue tiles)", () => {
    const rows = underTargetRows(costs.values());
    expect(rows.map((r) => r.cost.item.id).sort()).toEqual(["Burger", "Happy Burger"]);
    const ignored = ignoredKeySet([ignoredRow(belowTargetEntry(rows.find((r) => r.cost.item.id === "Burger")!, "Burger"))]);
    expect(openRows(rows, (r) => belowTargetKey(r.cost), ignored).map((r) => r.cost.item.id)).toEqual(["Happy Burger"]);
  });

  it("missing price: the Home count drops when one is ignored", () => {
    const groups = missingPriceGroups(costs.values());
    expect(groups).toHaveLength(1);
    const ignored = ignoredKeySet([ignoredRow(missingPriceEntry(groups[0]))]);
    expect(openRows(groups, (g) => `missing_price:${g.id}`, ignored)).toHaveLength(0);
  });

  it("need checking: an ignored check-cost alert stops counting in the pill, but its dish stays out of the average", () => {
    const all = [...costs.values()];
    const before = gpSummary(all);
    expect(before.excluded).toBeGreaterThanOrEqual(1);
    const groups = checkCostGroups(checkCostRows(all));
    const ignored = ignoredKeySet(groups.map((g) => ignoredRow(checkCostEntry(g))));
    const skip = ignoredCheckItemIds(groups, ignored);
    const after = gpSummary(all, null, skip);
    expect(after.excluded).toBe(0);
    expect(after.count).toBe(before.count);
    expect(after.avg).toBe(before.avg);
    // ignoring only some groups only skips those
    const one = ignoredCheckItemIds(groups, ignoredKeySet([ignoredRow(checkCostEntry(groups[0]))]));
    expect([...one]).toEqual(groups[0].itemIds);
  });
});

/* ---------- saving: a fake client ---------- */
type Row = Record<string, unknown>;
const MISSING = { code: "42P01", message: 'relation "public.cost_ignored_alerts" does not exist' };

function fake(o: { error?: { code?: string; message: string }; found?: Row[]; selectError?: { code?: string; message: string } } = {}) {
  const inserted: { table: string; payload: unknown }[] = [];
  const deleted: { table: string; key: string }[] = [];
  const client = {
    from(table: string) {
      let mode: "select" | "delete" = "select";
      let key = "";
      const q = {
        insert(payload: unknown) {
          inserted.push({ table, payload });
          return { select: () => Promise.resolve(o.error ? { data: null, error: o.error } : { data: [payload], error: null }) };
        },
        delete() {
          mode = "delete";
          return q;
        },
        select() {
          return q;
        },
        order: () => q,
        range: () => q,
        eq: (_c: string, v: string) => ((key = v), q),
        then: (res: (v: unknown) => void) => {
          if (mode === "delete") {
            deleted.push({ table, key });
            return res({ data: [], error: o.error ?? null });
          }
          if (o.selectError) return res({ data: null, error: o.selectError });
          res({ data: o.found ?? [], error: null });
        },
      };
      return q;
    },
  };
  return { sb: client as unknown as SupabaseClient, inserted, deleted };
}

const entry: AlertEntry = { key: "below_target:A:1000", kind: "below_target", ref: "/items/A", title: "A" };
const row = buildIgnoredRow(entry, "troy@sporksocials.com.au", "id1", "2026-10-04T00:00:00Z");

describe("saving ignores", () => {
  it("inserts through insertRow: one null-free row on cost_ignored_alerts", async () => {
    const f = fake();
    const r = await insertIgnoredAlert(f.sb, { ...row, ref: null, title: null });
    expect(r.created).toBe(true);
    expect(f.inserted).toHaveLength(1);
    expect(f.inserted[0].table).toBe("cost_ignored_alerts");
    const payload = f.inserted[0].payload as Row;
    expect(Object.values(payload).every((v) => v !== null && v !== undefined)).toBe(true);
    expect(payload).toMatchObject({ alert_key: entry.key, kind: "below_target", ignored_by: "troy@sporksocials.com.au" });
  });

  it("an alert someone else just ignored (unique key) comes back as theirs, not an error", async () => {
    const theirs = { ...row, id: "theirs", ignored_by: "abbey@sporksocials.com.au" };
    const f = fake({ error: { code: "23505", message: "duplicate key value" }, found: [theirs] });
    const r = await insertIgnoredAlert(f.sb, row);
    expect(r).toEqual({ row: theirs, created: false });
  });

  it("a database without the table fails with a plain message instead of crashing", async () => {
    for (const error of [MISSING, { code: "PGRST205", message: "Could not find the table 'public.cost_ignored_alerts' in the schema cache" }]) {
      await expect(insertIgnoredAlert(fake({ error }).sb, row)).rejects.toThrow(IGNORE_UNAVAILABLE);
      await expect(deleteIgnoredAlert(fake({ error }).sb, entry.key)).rejects.toThrow(IGNORE_UNAVAILABLE);
    }
  });

  it("any other database error keeps its own message", async () => {
    await expect(insertIgnoredAlert(fake({ error: { code: "42501", message: "permission denied" } }).sb, row)).rejects.toThrow("permission denied");
  });

  it("restore deletes by alert key, and deleting a row that is already gone is fine", async () => {
    const f = fake();
    await deleteIgnoredAlert(f.sb, entry.key);
    expect(f.deleted).toEqual([{ table: "cost_ignored_alerts", key: entry.key }]);
  });
});

describe("loading ignores", () => {
  it("a missing table reads as an empty list", async () => {
    expect(await fetchIgnoredAlerts(fake({ selectError: MISSING }).sb)).toEqual([]);
  });

  it("rows come back as saved; a real failure is not swallowed", async () => {
    expect(await fetchIgnoredAlerts(fake({ found: [row as unknown as Row] }).sb)).toEqual([row]);
    await expect(fetchIgnoredAlerts(fake({ selectError: { code: "57014", message: "timeout" } }).sb)).rejects.toThrow("timeout");
  });

  it("the table is part of the store's load, and optional so an older database still loads", () => {
    const spec = TABLES.find((t) => t.table === "cost_ignored_alerts");
    expect(spec).toMatchObject({ key: "ignoredAlerts", optional: true });
    const data = mergeRows({} as never, { cost_ignored_alerts: [row] });
    expect((data as unknown as { ignoredAlerts: IgnoredAlert[] }).ignoredAlerts).toEqual([row]);
    expect(rowsFromData(data as never).cost_ignored_alerts).toEqual([row]);
  });
});

/* ---------- every insert goes through insertRow / insertRows ---------- */
describe("no raw .insert(", () => {
  const roots = ["lib", "app", "components"];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name)) files.push(p);
    }
  };
  for (const r of roots) walk(path.join(process.cwd(), r));

  it("the only .insert( calls are the two helpers in lib/store.tsx", () => {
    const hits: string[] = [];
    for (const f of files) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((l, i) => {
          if (/\.insert\(/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l)) hits.push(`${path.relative(process.cwd(), f)}:${i + 1}: ${l.trim()}`);
        });
    }
    expect(hits).toEqual([
      expect.stringMatching(/^lib\/store\.tsx:\d+: return sb\.from\(table\)\.insert\(withoutNulls\(row\)\);$/),
      expect.stringMatching(/^lib\/store\.tsx:\d+: return sb\.from\(table\)\.insert\(rows\.map\(withoutNulls\)\);$/),
    ]);
  });
});
