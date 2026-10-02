import { describe, expect, it } from "vitest";
import { barIngredientName, barPhotoSrc, isStale, staleAge, slugForPhoto, glassType, isBarPath, ingredientDisplay, parseBarMenu, qtyText, shotsFor, syncedLabel, textList } from "@/lib/bar";

describe("shotsFor", () => {
  it("turns clean jigger measures into shots", () => {
    expect(shotsFor(15, "ml")).toBe("½ shot");
    expect(shotsFor(30, "ml")).toBe("1 shot");
    expect(shotsFor(45, "ml")).toBe("1½ shots");
    expect(shotsFor(60, "ml")).toBe("2 shots");
    expect(shotsFor(75, "ml")).toBe("2½ shots");
    expect(shotsFor(90, "ml")).toBe("3 shots");
    expect(shotsFor(120, "ml")).toBe("4 shots");
    expect(shotsFor(0.03, "L")).toBe("1 shot");
  });
  it("leaves small or odd amounts and other units alone", () => {
    expect(shotsFor(5, "ml")).toBeNull();
    expect(shotsFor(10, "ml")).toBeNull();
    expect(shotsFor(20, "ml")).toBeNull();
    expect(shotsFor(30, "g")).toBeNull();
    expect(shotsFor(2, "each")).toBeNull();
  });
});

describe("qtyText", () => {
  it("reads like the printed card", () => {
    expect(qtyText(60, "ml")).toBe("60ml");
    expect(qtyText(0.5, "g")).toBe("0.5g");
    expect(qtyText(0.2, "kg")).toBe("200g");
    expect(qtyText(2, "each")).toBe("2 each");
    expect(qtyText(0, "ml")).toBe("");
  });
});

describe("ingredientDisplay", () => {
  it("shows shots first with the ml underneath", () => {
    expect(ingredientDisplay({ name: "Aperol (700ml)", qty: 60, unit: "ml", note: null })).toMatchObject({ shots: "2 shots", qty: "60ml", plain: "", aside: null, name: "Aperol" });
  });
  it("uses the note as the amount when the pour isn't a clean shot", () => {
    expect(ingredientDisplay({ name: "Soda Water", qty: 15, unit: "ml", note: null }).shots).toBe("½ shot");
    expect(ingredientDisplay({ name: "Bitters", qty: 3, unit: "ml", note: "3 dashes" })).toMatchObject({ shots: null, plain: "3 dashes", aside: null });
    expect(ingredientDisplay({ name: "Agave", qty: 5, unit: "ml", note: null })).toMatchObject({ shots: null, plain: "5ml" });
  });
  it("lets an amount note replace a costing-estimate measure", () => {
    expect(ingredientDisplay({ name: "Soda Water", qty: 15, unit: "ml", note: "Splash" })).toMatchObject({ shots: null, plain: "Splash", aside: null });
    expect(ingredientDisplay({ name: "Petes Pure Prosecco (bottle 750ml)", qty: 90, unit: "ml", note: "Fill to the line" })).toMatchObject({ shots: null, plain: "Fill to the line" });
    expect(ingredientDisplay({ name: "Soda Water", qty: 30, unit: "ml", note: "Top with soda" })).toMatchObject({ shots: null, plain: "Top with soda" });
    expect(ingredientDisplay({ name: "Raw Sugar", qty: 5, unit: "g", note: "1 spoon, muddled" }).plain).toBe("1 spoon, muddled");
    expect(ingredientDisplay({ name: "Cinnamon", qty: 0.5, unit: "g", note: "Pinch" }).plain).toBe("Pinch");
  });
  it("keeps a note that adds to a clean measure", () => {
    expect(ingredientDisplay({ name: "House Pre-Mix (TBC)", qty: 75, unit: "ml", note: "2.5 shots — batch not yet defined" })).toMatchObject({ shots: "2½ shots", aside: "2.5 shots — batch not yet defined", name: "House Pre-Mix (TBC)" });
    expect(ingredientDisplay({ name: "Petes Pure Prosecco (bottle 750ml)", qty: 45, unit: "ml", note: "Poured on top, not shaken" })).toMatchObject({ shots: "1½ shots", aside: "Poured on top, not shaken" });
    expect(ingredientDisplay({ name: "Kraken (700ml)", qty: 15, unit: "ml", note: "Floated on top" })).toMatchObject({ shots: "½ shot", aside: "Floated on top", name: "Kraken" });
  });
});

describe("barIngredientName", () => {
  it("drops the pack size only", () => {
    expect(barIngredientName("Petes Pure Prosecco (bottle 750ml)")).toBe("Petes Pure Prosecco");
    expect(barIngredientName("Lime Juice (2L)")).toBe("Lime Juice");
    expect(barIngredientName("House Pre-Mix (TBC)")).toBe("House Pre-Mix (TBC)");
    expect(barIngredientName("Lime Juice (L)")).toBe("Lime Juice (L)");
    expect(barIngredientName("Dried Chilli (Each)")).toBe("Dried Chilli (Each)");
  });
});

describe("glassType", () => {
  it("matches the glass description", () => {
    expect(glassType("Martini Glass")).toBe("martini");
    expect(glassType("Rocks Glass, Salt Rim")).toBe("rocks");
    expect(glassType("Tall Glass")).toBe("highball");
    expect(glassType("Highball Glass")).toBe("highball");
    expect(glassType("Coupe Glass")).toBe("coupe");
    expect(glassType("Wine Glass")).toBe("wine");
    expect(glassType("Poco Glass, Coconut Rim")).toBe("rocks");
    expect(glassType(null)).toBe("rocks");
  });
});

describe("parseBarMenu", () => {
  it("normalises the database payload", () => {
    const m = parseBarMenu(
      {
        venue: { slug: "drift", name: "Drift Bar" },
        items: [{ id: "a", name: " Mojito ", category: "Cocktail", glass: " ", photo: " mojito.jpg ", method: ["Shake", " ", 4], garnish: "nope", lines: [{ name: "Mint", qty: "2", unit: "g", note: "" }] }],
      },
      "2026-10-02T00:00:00Z",
    );
    expect(m?.items[0]).toEqual({ id: "a", name: "Mojito", category: "Cocktail", glass: null, photo: "mojito.jpg", method: ["Shake"], garnish: [], lines: [{ name: "Mint", qty: 2, unit: "g", note: null }] });
    expect(parseBarMenu(null, "")).toBeNull();
  });
  it("textList ignores anything that isn't a list of strings", () => {
    expect(textList(null)).toEqual([]);
    expect(textList(["a", "", " b "])).toEqual(["a", "b"]);
  });
});

describe("syncedLabel", () => {
  const t = Date.parse("2026-10-02T10:00:00Z");
  it("counts minutes then hours", () => {
    expect(syncedLabel("2026-10-02T10:00:00Z", t + 20_000)).toBe("Synced just now");
    expect(syncedLabel("2026-10-02T10:00:00Z", t + 4 * 60_000)).toBe("Synced 4 min ago");
    expect(syncedLabel("2026-10-02T10:00:00Z", t + 125 * 60_000)).toBe("Synced 2 hr ago");
  });
});

describe("isBarPath", () => {
  it("opens only the bar routes", () => {
    for (const p of ["/bar", "/bar/drift", "/bar/manifest.webmanifest", "/api/bar/greedy"]) expect(isBarPath(p)).toBe(true);
    for (const p of ["/", "/bars", "/barista", "/menu", "/api/demo-data", "/items/bar"]) expect(isBarPath(p)).toBe(false);
  });
});

describe("bar photos", () => {
  it("folds accents so a renamed drink keeps its file name", () => {
    expect(slugForPhoto("Piña Colada")).toBe("pina-colada");
    expect(slugForPhoto("Uncle Mark's Old Fashioned")).toBe("uncle-marks-old-fashioned");
    expect(slugForPhoto("Uncle Mark\u2019s Old Fashioned")).toBe("uncle-marks-old-fashioned");
    expect(slugForPhoto("  Espresso   Martini! ")).toBe("espresso-martini");
  });
  it("prefers the item's own photo file over its name", () => {
    expect(barPhotoSrc("Piña Colada Special", "pina-colada.jpg")).toBe("/bar/cocktails/pina-colada.jpg");
    expect(barPhotoSrc("Mai Tai", null)).toBe("/bar/cocktails/mai-tai.jpg");
    expect(barPhotoSrc("Mai Tai")).toBe("/bar/cocktails/mai-tai.jpg");
  });
  it("ignores a stored value that isn't a plain image file name", () => {
    for (const bad of ["../secret.jpg", "a/b.jpg", "/etc/passwd", ".hidden.jpg", "mai-tai.svg", "mai-tai", "http://x.com/a.jpg"]) {
      expect(barPhotoSrc("Mai Tai", bad)).toBe("/bar/cocktails/mai-tai.jpg");
    }
  });
});

describe("bar screens text contrast", () => {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  it("keeps every light text colour at 4.5:1 or better on the lightest card state (WCAG AA)", async () => {
    const { readFileSync } = await import("node:fs");
    const worstCard = "#232327"; // a pressed tile
    const found = new Set<string>();
    for (const f of ["components/bar/station.tsx", "app/bar/page.tsx"]) {
      for (const m of readFileSync(f, "utf8").matchAll(/(?:text|placeholder:text)-\[(#[0-9a-fA-F]{6})\]/g)) found.add(m[1].toUpperCase());
    }
    const light = [...found].filter((c) => lum(c) > 0.2); // dark text sits on light accent fills, checked by hand
    expect(light.length).toBeGreaterThan(0);
    for (const c of light) expect({ c, ratio: ratio(c, worstCard) >= 4.5 }).toEqual({ c, ratio: true });
  });
});

describe("stale copy", () => {
  const t0 = Date.parse("2026-10-03T08:00:00Z");
  const at = (mins: number) => t0 + mins * 60_000;
  it("flags a copy once it is 15 minutes old, not before", () => {
    expect(isStale("2026-10-03T08:00:00Z", at(0))).toBe(false);
    expect(isStale("2026-10-03T08:00:00Z", at(14))).toBe(false);
    expect(isStale("2026-10-03T08:00:00Z", at(15))).toBe(true);
    expect(isStale("not a date", at(0))).toBe(true);
  });
  it("words the age", () => {
    expect(staleAge("2026-10-03T08:00:00Z", at(0))).toBe("just now");
    expect(staleAge("2026-10-03T08:00:00Z", at(25))).toBe("25 min ago");
    expect(staleAge("2026-10-03T08:00:00Z", at(185))).toBe("3 hr ago");
    expect(staleAge("2026-10-03T08:00:00Z", at(60 * 72))).toBe("3 days ago");
  });
});
