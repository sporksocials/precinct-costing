import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { shotsFor } from "@/lib/bar";
import { bottleLineAmount, bottleMl, bottleSizeText, parseBarPremix, premixAmount, premixCountText, premixLineDisplay, premixUseDisplay, servesPerBottle, shotsText } from "@/lib/bar-premix";
import { stationWorkerSource } from "@/lib/sw-source";

const NOW = "2026-10-04T08:00:00.000Z";

const payload = {
  venue: { slug: "drift", name: "Drift Bar" },
  premixes: [
    {
      id: "p2",
      name: "Bulcock Banger Pre-Mix",
      yield_qty: 0.7,
      yield_unit: "L",
      lines: [
        { name: "Havana Club 3yo (700ml)", qty: 240, unit: "ml", sort: 2 },
        { name: "Aperol (700ml)", qty: "180", unit: "ml", sort: 1 },
        { name: "Passoa (700ml)", qty: 116.6667, unit: "ml", sort: 3 },
        { name: "", qty: 5, unit: "ml", sort: 4 },
      ],
      used_in: [
        { drink: "Bulcock Banger", qty: 75, unit: "ml" },
        { drink: "Another Drink", qty: 60, unit: "ml" },
        { drink: "", qty: 1, unit: "ml" },
      ],
    },
    { id: "p1", name: "Barrel Aged Negroni Pre-Mix", yield_qty: "0.7", yield_unit: "L", lines: null, used_in: null },
    { id: "p3", name: "   ", yield_qty: 0.7, yield_unit: "L", lines: [], used_in: [] },
    null,
    "junk",
  ],
};

describe("parseBarPremix", () => {
  it("keeps good rows in order, drops malformed ones and coerces numbers", () => {
    const m = parseBarPremix(payload, NOW)!;
    expect(m.venue).toEqual({ slug: "drift", name: "Drift Bar" });
    expect(m.syncedAt).toBe(NOW);
    expect(m.premixes.map((p) => p.name)).toEqual(["Barrel Aged Negroni Pre-Mix", "Bulcock Banger Pre-Mix"]); // A to Z, blank and junk rows gone
    const banger = m.premixes[1];
    expect(banger.yieldQty).toBe(0.7);
    expect(banger.lines.map((l) => l.name)).toEqual(["Aperol (700ml)", "Havana Club 3yo (700ml)", "Passoa (700ml)"]); // by sort, blank name dropped
    expect(banger.lines[0].qty).toBe(180); // "180" coerced
    expect(banger.usedIn.map((u) => u.drink)).toEqual(["Another Drink", "Bulcock Banger"]);
    const negroni = m.premixes[0];
    expect(negroni).toMatchObject({ yieldQty: 0.7, yieldUnit: "L", lines: [], usedIn: [] });
  });
  it("returns null for an unknown venue or a reply of the wrong shape", () => {
    expect(parseBarPremix(null, NOW)).toBeNull();
    expect(parseBarPremix("x", NOW)).toBeNull();
    expect(parseBarPremix({}, NOW)).toBeNull();
    expect(parseBarPremix({ premixes: [] }, NOW)).toBeNull();
  });
  it("survives a venue with no pre-mixes", () => {
    expect(parseBarPremix({ venue: { slug: "greedy", name: "Greedy Gringo's" }, premixes: [] }, NOW)!.premixes).toEqual([]);
    expect(parseBarPremix({ venue: { slug: "greedy" } }, NOW)).toMatchObject({ venue: { slug: "greedy", name: "greedy" }, premixes: [] });
    expect(parseBarPremix({ venue: { slug: "greedy" }, premixes: "nope" }, NOW)!.premixes).toEqual([]);
  });
  it("turns non-numbers into 0 instead of NaN", () => {
    const m = parseBarPremix({ venue: { slug: "drift" }, premixes: [{ id: "a", name: "X Pre-Mix", yield_qty: "lots", yield_unit: "L", lines: [{ name: "Gin", qty: null, unit: "ml" }], used_in: [{ drink: "Y", qty: "", unit: "ml" }] }] }, NOW)!;
    expect(m.premixes[0].yieldQty).toBe(0);
    expect(m.premixes[0].lines[0].qty).toBe(0);
    expect(m.premixes[0].usedIn[0].qty).toBe(0);
  });
});

describe("bottle size", () => {
  it("reads 700 ml from 0.7 L", () => {
    expect(bottleMl({ yieldQty: 0.7, yieldUnit: "L" })).toBe(700);
    expect(bottleSizeText({ yieldQty: 0.7, yieldUnit: "L" })).toBe("700 ml bottle");
  });
  it("calls anything over a litre a batch and a non-volume yield what it is", () => {
    expect(bottleSizeText({ yieldQty: 1, yieldUnit: "L" })).toBe("1,000 ml bottle");
    expect(bottleSizeText({ yieldQty: 1.4, yieldUnit: "L" })).toBe("1.4 L batch");
    expect(bottleSizeText({ yieldQty: 2, yieldUnit: "kg" })).toBe("Makes 2 kg");
    expect(bottleMl({ yieldQty: 2, yieldUnit: "kg" })).toBeNull();
    expect(bottleSizeText({ yieldQty: 0, yieldUnit: "L" })).toBe("");
  });
});

describe("shotsText", () => {
  it("matches the cocktail card for the clean measures", () => {
    for (const ml of [15, 30, 45, 60, 75, 90, 120]) expect(shotsText(ml, "ml")).toBe(shotsFor(ml, "ml"));
    expect(shotsText(75, "ml")).toBe("2½ shots");
  });
  it("carries on past the card's table in 15 ml steps", () => {
    expect(shotsText(105, "ml")).toBe("3½ shots");
    expect(shotsText(150, "ml")).toBe("5 shots");
    expect(shotsText(180, "ml")).toBe("6 shots");
    expect(shotsText(0.045, "L")).toBe("1½ shots");
  });
  it("is null when the amount isn't a clean multiple of 15 ml or isn't a volume", () => {
    expect(shotsText(116.6667, "ml")).toBeNull();
    expect(shotsText(20, "ml")).toBeNull();
    expect(shotsText(5, "ml")).toBeNull();
    expect(shotsText(0, "ml")).toBeNull();
    expect(shotsText(30, "g")).toBeNull();
    expect(shotsText(2, "each")).toBeNull();
  });
});

describe("servesPerBottle", () => {
  it("is whole serves only", () => {
    expect(servesPerBottle(700, 75, "ml")).toBe(9);
    expect(servesPerBottle(700, 60, "ml")).toBe(11);
    expect(servesPerBottle(700, 30, "ml")).toBe(23);
    expect(servesPerBottle(700, 700, "ml")).toBe(1);
    expect(servesPerBottle(700, 100, "ml")).toBe(7); // exact division doesn't lose a serve to float error
    expect(servesPerBottle(700, 0.075, "L")).toBe(9);
  });
  it("is null when it can't be worked out", () => {
    expect(servesPerBottle(null, 75, "ml")).toBeNull();
    expect(servesPerBottle(700, 0, "ml")).toBeNull();
    expect(servesPerBottle(700, 2, "each")).toBeNull();
  });
});

describe("display text", () => {
  it("shows ml big with shots secondary only for clean pours", () => {
    expect(premixLineDisplay({ name: "Aperol (700ml)", qty: 180, unit: "ml", sort: 1 })).toEqual({ name: "Aperol", amount: "180 ml", shots: "6 shots" });
    expect(premixLineDisplay({ name: "Passoa (700ml)", qty: 116.6667, unit: "ml", sort: 2 })).toEqual({ name: "Passoa", amount: "116 ml", shots: null });
    expect(premixAmount(0.05, "L")).toBe("50 ml");
    expect(bottleLineAmount(233.3333, "ml")).toBe("233 ml");
    expect(bottleLineAmount(149.99999999, "ml")).toBe("150 ml");
    expect(bottleLineAmount(0.2333, "L")).toBe("233 ml");
    expect(bottleLineAmount(2, "each")).toBe("2 each");
    expect(premixAmount(2, "each")).toBe("2 each");
  });
  it("words 'used in' with the shots and how many serves a bottle makes", () => {
    expect(premixUseDisplay({ drink: "Bulcock Banger", qty: 75, unit: "ml" }, 700)).toEqual({ drink: "Bulcock Banger", pour: "2½ shots", serves: "9 serves per bottle" });
    expect(premixUseDisplay({ drink: "Odd", qty: 80, unit: "ml" }, 700)).toEqual({ drink: "Odd", pour: "80 ml", serves: "8 serves per bottle" });
    expect(premixUseDisplay({ drink: "Big", qty: 700, unit: "ml" }, 700).serves).toBe("1 serve per bottle");
    expect(premixUseDisplay({ drink: "Huge", qty: 800, unit: "ml" }, 700).serves).toBeNull();
    expect(premixUseDisplay({ drink: "No Bottle", qty: 75, unit: "ml" }, null).serves).toBeNull();
  });
  it("counts pre-mixes", () => {
    expect(premixCountText(1)).toBe("1 pre-mix");
    expect(premixCountText(5)).toBe("5 pre-mixes");
  });
});

describe("pre-mix page wiring", () => {
  it("the database function returns display fields only, never prices, costs or notes", () => {
    const sql = readFileSync("supabase/migrations/20261004130000_bar_premix.sql", "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(sql).toMatch(/create or replace function public\.cost_bar_premix\(p_venue text\)/);
    expect(sql).toMatch(/security definer/);
    expect(sql).toMatch(/grant execute on function public\.cost_bar_premix\(text\) to anon, authenticated/);
    expect(sql).toMatch(/revoke all on function public\.cost_bar_premix\(text\) from public/);
    expect(sql.replace(/comment on function[^;]*;/, "")).not.toMatch(/price|cost_per|pack_price|notes|target|supplier/i);
    // mirrored in schema.sql
    expect(readFileSync("supabase/schema.sql", "utf8")).toContain("create or replace function public.cost_bar_premix(p_venue text)");
  });
  it("the service worker will save the pre-mix page's API reply ahead of time and keeps refreshing it network first", () => {
    const sw = stationWorkerSource({ scope: "/bar", cachePrefix: "bar", photoPrefixes: ["/bar/cocktails/", "/bar/photo/"] });
    expect(sw).toContain("isStationApi(u.pathname)");
    expect(sw).toMatch(/isStationApi\(p\)\) return event\.respondWith\(networkFirst/);
  });
  it("the kiosk saves a venue's station together with its pre-mix page and data", () => {
    const kiosk = readFileSync("components/bar/kiosk.tsx", "utf8");
    expect(kiosk).toContain("/bar/${venue}/premix");
    expect(kiosk).toContain("/api/bar/${venue}/premix");
  });
  it("the pre-mix routes are public like the rest of the station", async () => {
    const { isBarPath } = await import("@/lib/bar");
    expect(isBarPath("/bar/drift/premix")).toBe(true);
    expect(isBarPath("/api/bar/drift/premix")).toBe(true);
  });
});
