import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { insertBarOption, mergeRows, rowsFromData } from "@/lib/store";
import { TABLES } from "@/lib/health";
import type { BarOption } from "@/lib/types";

type Row = Record<string, unknown>;

const GLASSES = ["Coupe Glass", "Rocks Glass", "High Ball Glass"].map((name, i): BarOption => ({ id: `g${i}`, kind: "glass", name, sort: i + 1 }));
const RIMS: BarOption[] = [{ id: "r0", kind: "rim", name: "Salt", sort: 1 }];
const EXISTING = [...GLASSES, ...RIMS];

/** A fake client that records inserts and can fail them. */
function fake(opts: { error?: { code?: string; message: string }; found?: Row[] } = {}) {
  const inserted: { table: string; payload: unknown }[] = [];
  const reads: string[] = [];
  const client = {
    from(table: string) {
      const q = {
        insert(payload: unknown) {
          inserted.push({ table, payload });
          return {
            select: () => Promise.resolve(opts.error ? { data: null, error: opts.error } : { data: [{ ...(payload as Row), created_at: "2026-10-04T00:00:00Z" }], error: null }),
          };
        },
        select() {
          reads.push(table);
          return q;
        },
        eq: () => q,
        then: (res: (v: unknown) => void) => res({ data: opts.found ?? [], error: null }),
      };
      return q;
    },
  };
  return { sb: client as unknown as SupabaseClient, inserted, reads };
}

describe("insertBarOption (the addBarOption action's database half)", () => {
  it("inserts through insertRow: null-free row, tidied name, sort after the last of that kind", async () => {
    const f = fake();
    const r = await insertBarOption(f.sb, EXISTING, "glass", "  tiki   mug ");
    expect(r.created).toBe(true);
    expect(r.option).toMatchObject({ kind: "glass", name: "Tiki Mug", sort: 4 });
    expect(f.inserted).toHaveLength(1);
    expect(f.inserted[0].table).toBe("cost_bar_options");
    const payload = f.inserted[0].payload as Row;
    expect(Object.values(payload).every((v) => v !== null && v !== undefined)).toBe(true);
    expect(payload.kind).toBe("glass");
    expect(typeof payload.id).toBe("string");
  });

  it("a rim loses a typed trailing 'Rim' and is sorted within the rims", async () => {
    const f = fake();
    const r = await insertBarOption(f.sb, EXISTING, "rim", "tajin RIM");
    expect(r.option).toMatchObject({ kind: "rim", name: "Tajin", sort: 2 });
  });

  it("a duplicate in any case is not inserted twice: the existing option comes back", async () => {
    const f = fake();
    const r = await insertBarOption(f.sb, EXISTING, "glass", "ROCKS glass");
    expect(r.created).toBe(false);
    expect(r.option.id).toBe("g1");
    expect(f.inserted).toHaveLength(0);
  });

  it("the same name is allowed once per kind", async () => {
    const f = fake();
    const r = await insertBarOption(f.sb, EXISTING, "rim", "Coupe Glass");
    expect(r.created).toBe(true);
  });

  it("an empty or dash-only name throws and writes nothing", async () => {
    const f = fake();
    await expect(insertBarOption(f.sb, EXISTING, "glass", "   ")).rejects.toThrow();
    await expect(insertBarOption(f.sb, EXISTING, "glass", " , ")).rejects.toThrow();
    expect(f.inserted).toHaveLength(0);
  });

  it("a database error throws with its message (so the caller leaves the local list alone)", async () => {
    const f = fake({ error: { message: "permission denied for table cost_bar_options" } });
    await expect(insertBarOption(f.sb, EXISTING, "glass", "Tiki Mug")).rejects.toThrow(/permission denied/);
  });

  it("a unique violation (someone added it a moment ago) returns their row instead of failing", async () => {
    const theirs = { id: "x1", kind: "glass", name: "Tiki Mug", sort: 9 };
    const f = fake({ error: { code: "23505", message: "duplicate key" }, found: [theirs] });
    const r = await insertBarOption(f.sb, EXISTING, "glass", "tiki mug");
    expect(r).toEqual({ option: theirs, created: false });
    expect(f.reads).toContain("cost_bar_options");
  });
});

describe("bar options in the store data", () => {
  it("is a registered optional table, loaded by sort", () => {
    const spec = TABLES.find((t) => t.table === "cost_bar_options");
    expect(spec).toMatchObject({ key: "barOptions", order: "sort", optional: true });
  });

  it("rowsFromData and mergeRows carry it", () => {
    const base = mergeRows({ rawSettings: [], barOptions: [] } as never, { cost_bar_options: EXISTING });
    expect((base as unknown as { barOptions: BarOption[] }).barOptions).toHaveLength(4);
    expect(rowsFromData(base as never).cost_bar_options).toHaveLength(4);
  });
});
