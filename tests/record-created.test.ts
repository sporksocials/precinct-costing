import { describe, expect, it } from "vitest";
import type { HistoryRow } from "@/lib/change-history";
import { CREATION_WINDOW_MS, STAMP_COLUMNS, createdLine, creationRow, dateTimeLabel, dateWithYear, historyChildTables, historyChildWord, lastChangedLine, loadRecordHistory, recordStatusLines, type CreatedInput } from "@/lib/record-created";
import { recordEventsForTable } from "@/lib/undo-change";
import { RESTORABLE } from "@/lib/trash";

let n = 0;
const row = (o: Partial<HistoryRow>): HistoryRow => ({
  id: ++n,
  table_name: "cost_beers",
  row_key: "b1",
  op: "update",
  old_row: null,
  new_row: null,
  changed_fields: [],
  parent_table: null,
  parent_id: null,
  changed_by: "brendan@precinct.local",
  changed_at: "2026-10-05T03:38:00Z", // Mon 5 Oct 1:38pm Brisbane
  ...o,
});
const nameOf = (e: string | null | undefined) => (e ? (e.startsWith("brendan") ? "Brendan" : e.startsWith("troy") ? "Troy" : e.split("@")[0]) : null);
const NOW = new Date("2026-10-06T00:00:00Z");
const input = (rows: HistoryRow[], extra: Partial<CreatedInput> = {}): CreatedInput => ({ rows, table: "cost_beers", key: "b1", nameOf, now: NOW, ...extra });

describe("Brisbane formatting", () => {
  it("formats a date time in Brisbane time without a year this year", () => {
    expect(dateTimeLabel("2026-10-05T03:38:00Z", NOW)).toBe("Mon 5 Oct 1:38pm");
  });
  it("rolls over the day in Brisbane time (UTC+10)", () => {
    // 22:30 UTC on 4 Oct is 8:30am on 5 Oct in Brisbane
    expect(dateTimeLabel("2026-10-04T22:30:00Z", NOW)).toBe("Mon 5 Oct 8:30am");
    expect(dateTimeLabel("2026-10-05T14:05:00Z", NOW)).toBe("Tue 6 Oct 12:05am");
  });
  it("adds the year when it is not this year", () => {
    expect(dateTimeLabel("2025-12-24T03:00:00Z", NOW)).toBe("Wed 24 Dec 2025 1:00pm");
  });
  it("dateWithYear always has the year and no time", () => {
    expect(dateWithYear("2026-09-24T03:00:00Z")).toBe("Thu 24 Sep 2026");
    expect(dateWithYear("2026-09-23T15:00:00Z")).toBe("Thu 24 Sep 2026");
  });
});

describe("createdLine", () => {
  it("names who made it when an insert row exists", () => {
    const rows = [row({ op: "insert" })];
    expect(createdLine(input(rows))).toBe("Created by Brendan, Mon 5 Oct 1:38pm");
  });
  it("uses the earliest insert (a record put back from Trash has two)", () => {
    const rows = [row({ op: "insert", changed_by: "troy@x.au", changed_at: "2026-10-06T01:00:00Z" }), row({ op: "insert", changed_by: "brendan@x.au", changed_at: "2026-10-05T03:38:00Z" })];
    expect(createdLine(input(rows))).toBe("Created by Brendan, Mon 5 Oct 1:38pm");
    expect(creationRow(rows, "cost_beers", "b1")?.changed_by).toBe("brendan@x.au");
  });
  it("breaks a tie on time by the lower row id", () => {
    const a = row({ op: "insert", changed_by: "troy@x.au" });
    const b = row({ op: "insert", changed_by: "brendan@x.au" });
    expect(creationRow([b, a], "cost_beers", "b1")?.id).toBe(a.id);
  });
  it("ignores inserts of other records and child rows", () => {
    const rows = [row({ op: "insert", row_key: "b2" }), row({ op: "insert", table_name: "cost_beer_prices", row_key: "p1", parent_table: "cost_beers", parent_id: "b1" })];
    expect(createdLine(input(rows, { stamps: { created_at: "2026-09-24T03:00:00Z" } }))).toBe("Created Thu 24 Sep 2026. Who created it was not recorded.");
  });
  it("says Database when changed_by is null, never blank", () => {
    expect(createdLine(input([row({ op: "insert", changed_by: null })]))).toBe("Created by Database, Mon 5 Oct 1:38pm");
    expect(createdLine(input([row({ op: "insert", changed_by: "  " })]))).toBe("Created by Database, Mon 5 Oct 1:38pm");
  });
  it("falls back to the email when no name is known", () => {
    expect(createdLine(input([row({ op: "insert" })], { nameOf: () => null }))).toBe("Created by brendan@precinct.local, Mon 5 Oct 1:38pm");
  });
  it("older record: created_at, with the honest sentence", () => {
    expect(createdLine(input([], { stamps: { created_at: "2026-09-24T03:00:00Z" } }))).toBe("Created Thu 24 Sep 2026. Who created it was not recorded.");
  });
  it("older record whose table has no created_at (or it is null)", () => {
    const want = "Created before change history began. Who created it was not recorded.";
    expect(createdLine(input([]))).toBe(want);
    expect(createdLine(input([], { stamps: null }))).toBe(want);
    expect(createdLine(input([], { stamps: { created_at: null } }))).toBe(want);
    expect(createdLine(input([], { stamps: { created_at: "not a date" } }))).toBe(want);
  });
  it("an unreadable history claims nothing about who", () => {
    expect(createdLine(input([], { historyKnown: false, stamps: { created_at: "2026-09-24T03:00:00Z" } }))).toBe("Created Thu 24 Sep 2026.");
    expect(createdLine(input([], { historyKnown: false }))).toBeNull();
  });
});

describe("lastChangedLine", () => {
  const created = row({ op: "insert", changed_by: "troy@x.au", changed_at: "2026-10-05T03:00:00Z" });
  it("is null when nothing changed since creation", () => {
    expect(lastChangedLine(input([created]))).toBeNull();
    expect(lastChangedLine(input([]))).toBeNull();
  });
  it("is null for the lines saved a moment after the record itself", () => {
    const line = row({ op: "insert", table_name: "cost_beer_prices", row_key: "p1", parent_table: "cost_beers", parent_id: "b1", changed_at: "2026-10-05T03:00:30Z" });
    expect(lastChangedLine(input([created, line]))).toBeNull();
  });
  it("counts a line added well after creation", () => {
    const line = row({ op: "insert", table_name: "cost_beer_prices", row_key: "p1", parent_table: "cost_beers", parent_id: "b1", changed_at: new Date(Date.parse(created.changed_at) + CREATION_WINDOW_MS + 5000).toISOString() });
    expect(lastChangedLine(input([created, line]))).toBe("Last changed by Brendan, Mon 5 Oct 1:02pm");
  });
  it("uses the newest event, whoever made it, child rows included", () => {
    const edit = row({ changed_by: "troy@x.au", changed_at: "2026-10-05T05:00:00Z" });
    const childEdit = row({ table_name: "cost_beer_prices", row_key: "p1", parent_table: "cost_beers", parent_id: "b1", changed_by: "brendan@x.au", changed_at: "2026-10-05T06:15:00Z" });
    expect(lastChangedLine(input([created, edit, childEdit]))).toBe("Last changed by Brendan, Mon 5 Oct 4:15pm");
    expect(lastChangedLine(input([childEdit, edit, created]))).toBe("Last changed by Brendan, Mon 5 Oct 4:15pm");
  });
  it("ignores events of other records", () => {
    expect(lastChangedLine(input([created, row({ row_key: "other", changed_at: "2026-10-05T07:00:00Z" })]))).toBeNull();
  });
  it("null changed_by reads Database", () => {
    expect(lastChangedLine(input([created, row({ changed_by: null, changed_at: "2026-10-05T05:00:00Z" })]))).toBe("Last changed by Database, Mon 5 Oct 3:00pm");
  });
  it("an older record with an event but no insert row still gets a line", () => {
    expect(lastChangedLine(input([row({ changed_at: "2026-10-05T05:00:00Z" })]))).toBe("Last changed by Brendan, Mon 5 Oct 3:00pm");
  });
  it("uses the updated_by stamp of a dish when it is newer than the events", () => {
    const edit = row({ changed_at: "2026-10-05T05:00:00Z" });
    const stamps = { created_at: "2026-09-24T03:00:00Z", updated_by: "troy@x.au", updated_at: "2026-10-05T08:00:00Z" };
    expect(lastChangedLine(input([created, edit], { stamps }))).toBe("Last changed by Troy, Mon 5 Oct 6:00pm");
  });
  it("prefers the event when the stamp is the same moment (the stamp is only a bookkeeping echo)", () => {
    const edit = row({ changed_by: "troy@x.au", changed_at: "2026-10-05T05:00:00Z" });
    expect(lastChangedLine(input([created, edit], { stamps: { updated_by: "brendan@x.au", updated_at: "2026-10-05T05:00:20Z" } }))).toBe("Last changed by Troy, Mon 5 Oct 3:00pm");
  });
  it("a stamp alone (a dish edited before history began)", () => {
    const stamps = { created_at: "2026-09-24T03:00:00Z", updated_by: "brendan@x.au", updated_at: "2026-10-02T03:00:00Z" };
    expect(lastChangedLine(input([], { stamps }))).toBe("Last changed by Brendan, Fri 2 Oct 1:00pm");
  });
  it("a stamp made while creating is not a change, and no stamp name means no line", () => {
    expect(lastChangedLine(input([], { stamps: { created_at: "2026-09-24T03:00:00Z", updated_by: "brendan@x.au", updated_at: "2026-09-24T03:00:05Z" } }))).toBeNull();
    expect(lastChangedLine(input([], { stamps: { created_at: "2026-09-24T03:00:00Z", updated_by: null, updated_at: "2026-10-02T03:00:00Z" } }))).toBeNull();
  });
  it("a stamp with no date still names the person", () => {
    expect(lastChangedLine(input([], { stamps: { updated_by: "troy@x.au" } }))).toBe("Last changed by Troy");
  });
  it("recordStatusLines returns both", () => {
    const edit = row({ changed_at: "2026-10-05T05:00:00Z" });
    expect(recordStatusLines(input([created, edit]))).toEqual({ created: "Created by Troy, Mon 5 Oct 1:00pm", lastChanged: "Last changed by Brendan, Mon 5 Oct 3:00pm" });
  });
});

describe("child tables and wording", () => {
  it("come from the restore registry", () => {
    expect(historyChildTables("cost_beers")).toEqual(["cost_beer_prices"]);
    expect(historyChildTables("cost_gelato_serves")).toEqual(["cost_gelato_serve_lines"]);
    expect(historyChildTables("cost_offers")).toEqual(["cost_offer_lines"]);
    expect(historyChildTables("cost_menu_items")).toEqual(["cost_recipe_lines"]);
    expect(historyChildTables("cost_ingredients")).toEqual([]);
    expect(historyChildTables("cost_ingredient_deals")).toEqual([]);
    for (const t of Object.keys(RESTORABLE)) expect(historyChildWord(t) === null).toBe(historyChildTables(t).length === 0);
  });
  it("every table with a created_at column is listed; suppliers are not", () => {
    for (const t of ["cost_menu_items", "cost_preps", "cost_ingredients", "cost_beers", "cost_beer_serves", "cost_gelato_serves", "cost_offers", "cost_ingredient_deals", "cost_specials"]) expect(STAMP_COLUMNS[t]).toContain("created_at");
    expect(STAMP_COLUMNS.cost_suppliers).toBeUndefined();
    expect(STAMP_COLUMNS.cost_menu_items).toContain("updated_by");
    expect(STAMP_COLUMNS.cost_preps).toContain("updated_by");
  });
});

describe("recordEventsForTable (the shared list)", () => {
  const describe1 = (r: HistoryRow) => [{ id: `hist:${r.id}`, title: `T${r.id}`, oldValue: "a", newValue: "b" }];
  it("covers the record and its children for any table, newest first", () => {
    const rows = [
      row({ changed_at: "2026-10-05T03:00:00Z" }),
      row({ table_name: "cost_beer_prices", row_key: "p1", parent_table: "cost_beers", parent_id: "b1", changed_at: "2026-10-05T04:00:00Z" }),
      row({ row_key: "other", changed_at: "2026-10-05T05:00:00Z" }),
    ];
    const ev = recordEventsForTable(rows, "cost_beers", "b1", describe1);
    expect(ev.map((e) => e.row.id)).toEqual([rows[1].id, rows[0].id]);
  });
});

describe("loadRecordHistory never throws", () => {
  const failing = { from: () => { throw new Error("offline"); } } as never;
  it("an unreadable database is no history, not an error", async () => {
    const r = await loadRecordHistory(failing, "cost_beers", "b1");
    expect(r.rows).toEqual([]);
    expect(r.historyKnown).toBe(false);
    expect(r.stamps).toBeNull();
  });
  it("a missing history table is no history", async () => {
    const q = (data: unknown, error: unknown) => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "range", "limit"]) b[m] = () => b;
      b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data, error }).then(ok);
      return b;
    };
    const sb = { from: (t: string) => (t === "cost_change_history" ? q(null, { code: "42P01", message: "relation does not exist" }) : q([{ created_at: "2026-09-24T03:00:00Z" }], null)) } as never;
    const r = await loadRecordHistory(sb, "cost_beers", "b1");
    expect(r.rows).toEqual([]);
    expect(r.stamps).toEqual({ created_at: "2026-09-24T03:00:00Z" });
    expect(createdLine({ rows: r.rows, table: "cost_beers", key: "b1", stamps: r.stamps, nameOf, historyKnown: r.historyKnown })).toBe("Created Thu 24 Sep 2026.");
  });
});
