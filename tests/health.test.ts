import { describe, expect, it } from "vitest";
import {
  FetchError,
  TABLES,
  changedTables,
  compareFingerprint,
  formatVerifiedTime,
  isBlocked,
  isSchemaMissingError,
  parseFingerprint,
  reconcile,
  shouldRevalidate,
  writeCheckDelay,
  type RemoteFingerprint,
} from "@/lib/health";

const rowsOf = (n: number, prefix = "r") => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));
const fp = (counts: Record<string, number>, hashes: Record<string, string> = {}): RemoteFingerprint => ({
  tables: Object.fromEntries(Object.entries(counts).map(([t, c]) => [t, { count: c, hash: hashes[t] ?? `h-${t}-${c}` }])),
});

describe("compareFingerprint", () => {
  it("is ok when counts match and keys are unique", () => {
    const r = compareFingerprint({ cost_recipe_lines: rowsOf(10), cost_menu_items: rowsOf(3) }, fp({ cost_recipe_lines: 10, cost_menu_items: 3 }));
    expect(r).toEqual({ ok: true, mismatches: [] });
  });

  it("flags a table that is short, with loaded and expected counts", () => {
    const r = compareFingerprint({ cost_recipe_lines: rowsOf(2316) }, fp({ cost_recipe_lines: 2395 }));
    expect(r.ok).toBe(false);
    expect(r.mismatches).toEqual([{ table: "cost_recipe_lines", loaded: 2316, expected: 2395, reason: "count" }]);
  });

  it("flags duplicated rows even when the count happens to match", () => {
    const rows = [{ id: "a" }, { id: "a" }, { id: "c" }]; // 'b' dropped, 'a' repeated
    const r = compareFingerprint({ cost_recipe_lines: rows }, fp({ cost_recipe_lines: 3 }));
    expect(r.mismatches[0]).toMatchObject({ table: "cost_recipe_lines", reason: "duplicate" });
  });

  it("uses the real primary key: composite for targets, key for settings, email for users", () => {
    const targets = [
      { venue_id: 1, category: "Food" },
      { venue_id: 1, category: "Wine" },
      { venue_id: 2, category: "Food" },
    ];
    expect(compareFingerprint({ cost_targets: targets }, fp({ cost_targets: 3 })).ok).toBe(true);
    expect(compareFingerprint({ cost_settings: [{ key: "gst" }, { key: "gst" }] }, fp({ cost_settings: 2 })).ok).toBe(false);
    expect(compareFingerprint({ cost_allowed_users: [{ email: "a@x" }, { email: "b@x" }] }, fp({ cost_allowed_users: 2 })).ok).toBe(true);
  });

  it("only compares tables present on both sides", () => {
    expect(compareFingerprint({ cost_beers: rowsOf(1) }, fp({ cost_recipe_lines: 5 })).ok).toBe(true);
  });
});

describe("parseFingerprint / changedTables / isBlocked", () => {
  it("parses the database's jsonb and rejects junk", () => {
    const parsed = parseFingerprint({ generated_at: "2026-09-26T00:00:00Z", cost_venues: { count: 4, hash: "abc" }, cost_beers: { count: 0, hash: "d41d8" } });
    expect(parsed?.tables.cost_venues).toEqual({ count: 4, hash: "abc" });
    expect(parsed?.generatedAt).toBe("2026-09-26T00:00:00Z");
    expect(parseFingerprint(null)).toBeNull();
    expect(parseFingerprint({})).toBeNull();
    expect(parseFingerprint({ cost_venues: { count: "nope" } })).toBeNull();
  });

  it("names the tables whose hash or count moved", () => {
    const a = fp({ cost_ingredients: 5, cost_menu_items: 3 }, { cost_ingredients: "x", cost_menu_items: "y" });
    const b = fp({ cost_ingredients: 5, cost_menu_items: 3 }, { cost_ingredients: "CHANGED", cost_menu_items: "y" });
    expect(changedTables(a, b)).toEqual(["cost_ingredients"]);
    expect(changedTables(a, a)).toEqual([]);
    expect(changedTables(a, fp({ cost_ingredients: 6, cost_menu_items: 3 }, { cost_ingredients: "x", cost_menu_items: "y" }))).toEqual(["cost_ingredients"]);
  });

  it("ignores hashes when one side only has counts", () => {
    const withHash = fp({ cost_ingredients: 5 }, { cost_ingredients: "x" });
    const countsOnly: RemoteFingerprint = { tables: { cost_ingredients: { count: 5 } } };
    expect(changedTables(withHash, countsOnly)).toEqual([]);
  });

  it("is blocked only when every table counts zero", () => {
    expect(isBlocked(fp({ cost_venues: 0, cost_menu_items: 0 }))).toBe(true);
    expect(isBlocked(fp({ cost_venues: 4, cost_menu_items: 0 }))).toBe(false);
    expect(isBlocked(null)).toBe(false);
  });
});

describe("isSchemaMissingError", () => {
  it("tolerates only missing relation / column / function errors", () => {
    expect(isSchemaMissingError({ code: "42P01", message: "x" })).toBe(true);
    expect(isSchemaMissingError({ code: "42703", message: "x" })).toBe(true);
    expect(isSchemaMissingError({ code: "PGRST205", message: "x" })).toBe(true);
    expect(isSchemaMissingError({ code: "PGRST204", message: "x" })).toBe(true);
    expect(isSchemaMissingError(new FetchError("cost_beers", "relation \"cost_beers\" does not exist", undefined))).toBe(true);
    expect(isSchemaMissingError({ message: "Could not find the table 'public.cost_beers' in the schema cache" })).toBe(true);
  });

  it("never tolerates network, permission or timeout errors", () => {
    expect(isSchemaMissingError({ message: "TypeError: Failed to fetch" })).toBe(false);
    expect(isSchemaMissingError({ code: "42501", message: "permission denied for table cost_beers" })).toBe(false);
    expect(isSchemaMissingError({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(false);
    expect(isSchemaMissingError({ code: "PGRST301", message: "JWT expired" })).toBe(false);
    expect(isSchemaMissingError(null)).toBe(false);
    expect(isSchemaMissingError("boom")).toBe(false);
  });
});

describe("revalidation policy", () => {
  const T = 1_000_000;
  it("never runs while the tab is hidden", () => {
    expect(shouldRevalidate(null, null, T, true)).toBe(false);
    expect(shouldRevalidate(T - 10 * 60_000, T - 60_000, T, true)).toBe(false);
  });

  it("runs on focus only when the last check is over 2 minutes old", () => {
    expect(shouldRevalidate(T - 60_000, null, T, false)).toBe(false);
    expect(shouldRevalidate(T - 121_000, null, T, false)).toBe(true);
    expect(shouldRevalidate(null, null, T, false)).toBe(true);
  });

  it("uses the longer 3 minute window for the periodic check", () => {
    expect(shouldRevalidate(T - 150_000, null, T, false, 180_000)).toBe(false);
    expect(shouldRevalidate(T - 181_000, null, T, false, 180_000)).toBe(true);
  });

  it("checks about 8 seconds after the last write, at most once per 30 seconds", () => {
    expect(writeCheckDelay(null, null, T)).toBeNull();
    expect(writeCheckDelay(T - 999_999, T - 2_000, T)).toBe(6_000); // settle
    expect(writeCheckDelay(T - 10_000, T - 9_000, T)).toBe(20_000); // 30s gap since the last check
    expect(writeCheckDelay(T - 1_000, T - 5_000, T)).toBeNull(); // a check already ran after the write
    expect(shouldRevalidate(T - 999_999, T - 3_000, T, false)).toBe(false);
    expect(shouldRevalidate(T - 999_999, T - 9_000, T, false)).toBe(true);
    expect(shouldRevalidate(T - 20_000, T - 9_000, T, false)).toBe(false);
  });
});

describe("formatVerifiedTime", () => {
  it("shows Brisbane time like 2:14pm", () => {
    expect(formatVerifiedTime("2026-09-26T04:14:00Z")).toBe("2:14pm"); // AEST is UTC+10, no daylight saving
    expect(formatVerifiedTime("2026-09-25T23:05:00Z")).toBe("9:05am");
    expect(formatVerifiedTime(null)).toBeNull();
    expect(formatVerifiedTime("nonsense")).toBeNull();
  });
});

describe("reconcile", () => {
  const all = { cost_recipe_lines: rowsOf(100, "l"), cost_menu_items: rowsOf(10, "m") };

  it("does nothing when everything matches", async () => {
    let calls = 0;
    const r = await reconcile({
      rows: all,
      remote: fp({ cost_recipe_lines: 100, cost_menu_items: 10 }),
      refetch: async () => (calls++, []),
      remeasure: async () => null,
    });
    expect(calls).toBe(0);
    expect(r.mismatches).toEqual([]);
    expect(r.attempts).toBe(0);
  });

  it("refetches only the short table and re-verifies", async () => {
    const fetched: string[] = [];
    const r = await reconcile({
      rows: { ...all, cost_recipe_lines: rowsOf(79, "l") },
      remote: fp({ cost_recipe_lines: 100, cost_menu_items: 10 }),
      refetch: async (t) => (fetched.push(t), all[t as keyof typeof all]),
      remeasure: async () => fp({ cost_recipe_lines: 100, cost_menu_items: 10 }),
    });
    expect(fetched).toEqual(["cost_recipe_lines"]);
    expect(r.mismatches).toEqual([]);
    expect(r.refetched).toEqual(["cost_recipe_lines"]);
    expect(r.rows.cost_recipe_lines).toHaveLength(100);
    expect(r.attempts).toBe(1);
  });

  it("gives up after two attempts and reports what is still wrong", async () => {
    let calls = 0;
    const r = await reconcile({
      rows: { ...all, cost_recipe_lines: rowsOf(79, "l") },
      remote: fp({ cost_recipe_lines: 100, cost_menu_items: 10 }),
      refetch: async () => (calls++, rowsOf(90, "l")),
      remeasure: async () => fp({ cost_recipe_lines: 100, cost_menu_items: 10 }),
    });
    expect(calls).toBe(2);
    expect(r.attempts).toBe(2);
    expect(r.mismatches).toEqual([{ table: "cost_recipe_lines", loaded: 90, expected: 100, reason: "count" }]);
  });

  it("treats a failing refetch as still broken, by name", async () => {
    const r = await reconcile({
      rows: { ...all, cost_menu_items: rowsOf(4, "m") },
      remote: fp({ cost_recipe_lines: 100, cost_menu_items: 10 }),
      refetch: async () => {
        throw new Error("network down");
      },
      remeasure: async () => null,
    });
    expect(r.mismatches).toHaveLength(1);
    expect(r.mismatches[0]).toMatchObject({ table: "cost_menu_items", reason: "error", message: "network down" });
  });

  it("reports unverified when there is no fingerprint", async () => {
    const r = await reconcile({ rows: all, remote: null, refetch: async () => [], remeasure: async () => null });
    expect(r.unverified).toBe(true);
    expect(r.mismatches).toEqual([]);
  });

  it("announces healing once", async () => {
    let announced = 0;
    await reconcile({
      rows: { cost_recipe_lines: rowsOf(1) },
      remote: fp({ cost_recipe_lines: 5 }),
      refetch: async () => rowsOf(2),
      remeasure: async () => fp({ cost_recipe_lines: 5 }),
      onHealing: () => announced++,
    });
    expect(announced).toBe(1);
  });
});

describe("table registry", () => {
  it("covers every table once", () => {
    expect(new Set(TABLES.map((t) => t.table)).size).toBe(TABLES.length);
    expect(TABLES).toHaveLength(19);
  });
});
