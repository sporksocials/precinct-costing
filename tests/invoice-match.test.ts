import { describe, expect, it } from "vitest";
import { abnDigits, descKey, dollars, nameTokens, normCode, plain, supplierNameKeys, tidyLabel, tokenOverlap } from "../lib/invoice-names";
import { buildMatcher, checkVenue, findDuplicate, matchSupplier } from "../lib/invoice-match";
import { classifyLine, findChargeRule } from "../lib/invoice-classify";
import { baseQuantity, canonicalUnit, deriveSafePacks, inferPackCounts, plausibleFactors, resolvePacks, unitsMatch } from "../lib/invoice-units";
import {
  CHIOBU, DRIFT, ING_BARRA, ING_GINGER, ING_KINGFISH, ING_LYCHEE, PROD_BARRA, SUP_DIABLO, SUP_DS, baseCtx, diabloMaps, ing, mapRow, prod, seededRules, supplierDS, supplierDiablo,
} from "./fixtures/invoice-fixtures";
import type { InvoiceChargeRuleRow, LineClass } from "../lib/invoice-types";

describe("names", () => {
  it("descKey is lower case, letters and digits, one space, size joined to its unit", () => {
    expect(descKey("Lychee Liqueur 700ml - Bottle")).toBe("lychee liqueur 700ml bottle");
    expect(descKey("LYCHEE  LIQUEUR 700 ML BOTTLE")).toBe("lychee liqueur 700ml bottle");
    expect(descKey("Tom & Jerry's  2.5kg")).toBe("tom and jerrys 2.5kg");
    expect(descKey(null)).toBe("");
  });

  it("normalises codes, ABNs and prose", () => {
    expect(normCode(" 15 026 ")).toBe("15026");
    expect(normCode("  ")).toBeNull();
    expect(abnDigits("61 151 388 094")).toBe("61151388094");
    expect(abnDigits("123")).toBeNull();
    expect(plain("a — b – c")).toBe("a - b - c");
    expect(dollars(-16.45)).toBe("-$16.45");
    expect(dollars(1234.5)).toBe("$1,234.50");
    expect(tidyLabel("Humpty Doo Barramundi fillets per kg")).toBe("Humpty Doo Barramundi fillets");
    expect(tidyLabel("BARRAMUNDI FILLETS")).toBe("Barramundi Fillets");
  });

  it("supplier name keys drop Pty Ltd and punctuation and split trading as", () => {
    expect(supplierNameKeys("Daniel Street Fish Market Pty. Ltd.")).toEqual(["daniel street fish market"]);
    expect(supplierNameKeys("CD Australia Pty Ltd trading as Diablo Co")).toEqual(["cd australia", "diablo co"]);
    expect(supplierNameKeys("A & B Foods T/A Bee's")).toEqual(["a and b foods", "bees"]);
  });

  it("fuzzy overlap scores shared words and needs a real word in common", () => {
    expect(tokenOverlap("Kingfish fillets skin on wing off per kg", "Kingfish Fillets (1kg)")).toBeGreaterThan(0.4);
    expect(tokenOverlap("700ml", "700ml")).toBe(0);
    expect(nameTokens("Fillets of Kingfish")).toEqual(["fillet", "kingfish"]);
  });
});

describe("matchSupplier", () => {
  const sups = [supplierDS(), supplierDiablo()];
  it("matches by ABN digits first, whatever the name says", () => {
    const m = matchSupplier({ supplier_name: "Some other name", supplier_abn: "61 151 388 094" }, sups);
    expect(m.status).toBe("matched");
    expect(m.supplier?.id).toBe(SUP_DS);
  });
  it("matches by name or alias, ignoring Pty Ltd, case and trading as", () => {
    expect(matchSupplier({ supplier_name: "DANIEL STREET FISH MARKET PTY LTD", supplier_abn: null }, sups).supplier?.id).toBe(SUP_DS);
    expect(matchSupplier({ supplier_name: "CD Australia Pty Ltd trading as Diablo Co", supplier_abn: null }, sups).supplier?.id).toBe(SUP_DIABLO);
    expect(matchSupplier({ supplier_name: "cd australia pty ltd", supplier_abn: null }, sups).supplier?.id).toBe(SUP_DIABLO);
  });
  it("a name match with a different ABN is a question, not an assumption", () => {
    const m = matchSupplier({ supplier_name: "Daniel Street Fish Market", supplier_abn: "11 222 333 444" }, sups);
    expect(m.status).toBe("abn_mismatch");
    expect(m.supplier?.id).toBe(SUP_DS);
  });
  it("no match is a new supplier; nothing readable is unreadable", () => {
    expect(matchSupplier({ supplier_name: "Brand New Produce", supplier_abn: null }, sups).status).toBe("new");
    expect(matchSupplier({ supplier_name: null, supplier_abn: null }, sups).status).toBe("unreadable");
  });
  it("a name that fits two suppliers is ambiguous", () => {
    const two = [supplierDS(), supplierDS({ id: "other", name: "Fish Market Two", aliases: ["Daniel Street Fish Market"], abn: null })];
    const m = matchSupplier({ supplier_name: "Daniel Street Fish Market", supplier_abn: null }, two);
    expect(m.status).toBe("ambiguous");
    expect(m.candidates).toHaveLength(2);
  });
});

describe("checkVenue", () => {
  const venues = baseCtx().venueNames;
  it("ok when only the folder venue is named, in any case, in bill-to or ship-to", () => {
    expect(checkVenue({ bill_to: "DRIFT BAR AND DINING", ship_to: null }, venues, DRIFT).check).toBe("ok");
    expect(checkVenue({ bill_to: "Caloundra Food Precinct", ship_to: "chiobu, bulcock st" }, venues, CHIOBU).check).toBe("ok");
    expect(checkVenue({ bill_to: "GREEDY GRINGOS", ship_to: null }, venues, 3).check).toBe("ok");
  });
  it("a different venue is a mismatch", () => {
    const r = checkVenue({ bill_to: "Chiobu", ship_to: null }, venues, DRIFT);
    expect(r.check).toBe("mismatch");
    expect(r.named.map((v) => v.name)).toEqual(["Chiobu"]);
  });
  it("no venue named, or several named, is unknown", () => {
    expect(checkVenue({ bill_to: "Some Pty Ltd", ship_to: null }, venues, DRIFT).check).toBe("unknown");
    expect(checkVenue({ bill_to: null, ship_to: null }, venues, DRIFT).check).toBe("unknown");
    expect(checkVenue({ bill_to: "Drift and Chiobu", ship_to: null }, venues, DRIFT).check).toBe("unknown");
  });
  it("does not match part of a longer word", () => {
    expect(checkVenue({ bill_to: "Driftwood Cafe", ship_to: null }, venues, DRIFT).check).toBe("unknown");
  });
});

describe("findDuplicate", () => {
  const existing = [{ id: "d1", venue_id: DRIFT, supplier_id: SUP_DS, invoice_number: "51329", status: "applied" as const }];
  it("same venue, supplier and number", () => {
    expect(findDuplicate("51329", DRIFT, SUP_DS, existing)).toBe("d1");
    expect(findDuplicate(" #51329 ", DRIFT, SUP_DS, existing)).toBe("d1");
  });
  it("a different venue, supplier or number is not a repeat", () => {
    expect(findDuplicate("51329", CHIOBU, SUP_DS, existing)).toBeNull();
    expect(findDuplicate("51329", DRIFT, SUP_DIABLO, existing)).toBeNull();
    expect(findDuplicate("51330", DRIFT, SUP_DS, existing)).toBeNull();
    expect(findDuplicate(null, DRIFT, SUP_DS, existing)).toBeNull();
    expect(findDuplicate("51329", DRIFT, null, existing)).toBeNull();
  });
  it("earlier duplicates and failed reads do not count", () => {
    expect(findDuplicate("51329", DRIFT, SUP_DS, [{ ...existing[0], status: "duplicate" as const }])).toBeNull();
    expect(findDuplicate("51329", DRIFT, SUP_DS, [{ ...existing[0], status: "failed" as const }])).toBeNull();
  });
});

describe("classifyLine and charge rules", () => {
  const rules = seededRules();
  const C = (description: string, code: string | null = null, hint: LineClass | null = null, total: number | null = 10) => classifyLine({ description, item_code: code, class_hint: hint, total_ex: total }, rules, SUP_DS);

  it("delivery, fuel levy and discount lines are charges and spread; a deposit is left out", () => {
    expect(C("Delivery order over $200")).toMatchObject({ line_class: "delivery", spread: true });
    expect(C("FUEL LEVY")).toMatchObject({ line_class: "fee", spread: true });
    expect(C("Keg return deposit")).toMatchObject({ line_class: "deposit", spread: false });
    expect(C("Trade discount", null, null, -5)).toMatchObject({ line_class: "discount", spread: true });
  });
  it("the supplier's own rule beats a global one, then the longer text wins", () => {
    const own: InvoiceChargeRuleRow = { id: "own", supplier_id: SUP_DS, match_text: "delivery", line_class: "other", spread: false, note: null, active: true };
    expect(findChargeRule([...rules, own], SUP_DS, "Delivery", null)?.id).toBe("own");
    expect(findChargeRule([...rules, own], SUP_DIABLO, "Delivery", null)?.line_class).toBe("delivery");
    const longer: InvoiceChargeRuleRow = { id: "long", supplier_id: null, match_text: "delivery order", line_class: "fee", spread: false, note: null, active: true };
    expect(findChargeRule([...rules, longer], null, "Delivery order over $200", null)?.id).toBe("long");
  });
  it("an inactive rule, or another supplier's rule, does not apply", () => {
    const off: InvoiceChargeRuleRow = { id: "off", supplier_id: null, match_text: "pallet", line_class: "fee", spread: true, note: null, active: false };
    const theirs: InvoiceChargeRuleRow = { id: "theirs", supplier_id: SUP_DIABLO, match_text: "pallet", line_class: "fee", spread: true, note: null, active: true };
    expect(findChargeRule([off, theirs], SUP_DS, "Pallet charge", null)).toBeNull();
  });
  it("matches on the item code too", () => {
    const code: InvoiceChargeRuleRow = { id: "c", supplier_id: null, match_text: "99000", line_class: "delivery", spread: true, note: null, active: true };
    expect(classifyLine({ description: "Charge", item_code: "99000", class_hint: null, total_ex: 5 }, [code], null).line_class).toBe("delivery");
  });
  it("a negative product line is a credit; ODISCOUNT and a leading Discount are discounts", () => {
    expect(C("Barramundi", "15056", "product", -16.45).line_class).toBe("credit");
    expect(classifyLine({ description: "Order adjustment", item_code: "ODISCOUNT", class_hint: null, total_ex: -3 }, [], null).line_class).toBe("discount");
    expect(classifyLine({ description: "Discount 5%", item_code: null, class_hint: "product", total_ex: -3 }, [], null).line_class).toBe("discount");
  });
  it("an unknown charge keeps spread null so it is left out and asked about", () => {
    const r = classifyLine({ description: "Pallet charge", item_code: null, class_hint: "fee", total_ex: 12 }, [], null);
    expect(r).toMatchObject({ line_class: "fee", spread: null, rule: null });
  });
  it("a product stays a product", () => {
    expect(C("Kingfish fillets", "15026", null, 127.47).line_class).toBe("product");
  });
});

describe("units", () => {
  it("canonical units and product unit matching", () => {
    expect(canonicalUnit("CTN")).toBe("carton");
    expect(unitsMatch("CTN", "Carton")).toBe(true);
    expect(unitsMatch("BTL", "bottle")).toBe(true);
    expect(unitsMatch("KG", "carton")).toBe(false);
    expect(unitsMatch(null, "carton")).toBe(false);
  });
  it("derives only the safe cases", () => {
    expect(deriveSafePacks("KG", { pack_size: 1, pack_unit: "kg" })).toBe(1);
    expect(deriveSafePacks("KG", { pack_size: 2, pack_unit: "kg" })).toBe(0.5);
    expect(deriveSafePacks("KG", { pack_size: 500, pack_unit: "g" })).toBe(2);
    expect(deriveSafePacks("L", { pack_size: 5, pack_unit: "L" })).toBe(0.2);
    expect(deriveSafePacks("LT", { pack_size: 700, pack_unit: "ml" })).toBeCloseTo(1 / 0.7, 10);
    expect(deriveSafePacks("EA", { pack_size: 6, pack_unit: "each" })).toBeCloseTo(1 / 6, 10);
    // never a guess
    expect(deriveSafePacks("CTN", { pack_size: 700, pack_unit: "ml" })).toBeNull();
    expect(deriveSafePacks("KG", { pack_size: 700, pack_unit: "ml" })).toBeNull();
    expect(deriveSafePacks("EA", { pack_size: 700, pack_unit: "ml" })).toBeNull();
    expect(deriveSafePacks("KG", { pack_size: 0, pack_unit: "kg" })).toBeNull();
  });
  it("reads pack counts out of a description", () => {
    expect(inferPackCounts("Coke Zero 24x375ml")).toEqual([24]);
    expect(inferPackCounts("Vodka 6 x 700ml CTN")).toEqual([6]);
    expect(inferPackCounts("Water 12pk")).toEqual([12]);
    expect(inferPackCounts("Case of 24 cans")).toContain(24);
    expect(inferPackCounts("Kingfish fillets")).toEqual([]);
    expect(plausibleFactors("Coke Zero 24x375ml")).toEqual([24, 1, 6, 12]);
  });
  it("resolves packs: saved match, then the product, then the safe derivation; flags a conflict", () => {
    const p = prod({ id: "p", name: "Gin", unit_name: "carton", costing_packs_per_unit: 6 });
    const i = ing({ id: "i", name: "Gin", pack_size: 700, pack_unit: "ml" });
    expect(resolvePacks({ mapPacks: 12, product: null, ingredient: i, invoiceUnit: "CTN" })).toMatchObject({ packs: 12, source: "map", conflict: null });
    expect(resolvePacks({ mapPacks: null, product: p, ingredient: i, invoiceUnit: "CTN" })).toMatchObject({ packs: 6, source: "product", productUnitMatches: true });
    expect(resolvePacks({ mapPacks: null, product: { ...p, costing_packs_per_unit: null }, ingredient: i, invoiceUnit: "CTN" }).packs).toBe(1);
    expect(resolvePacks({ mapPacks: 12, product: p, ingredient: i, invoiceUnit: "CTN" }).conflict).toEqual({ mapPacks: 12, productPacks: 6 });
    // product unit not matching: falls back to the safe derivation or null
    expect(resolvePacks({ mapPacks: null, product: p, ingredient: i, invoiceUnit: "EA" }).packs).toBeNull();
    expect(resolvePacks({ mapPacks: null, product: null, ingredient: ing({ id: "k", name: "k" }), invoiceUnit: "KG" }).packs).toBe(1);
  });
  it("base quantity is qty x packs x pack size in the base unit", () => {
    expect(baseQuantity(1.85, 1, { pack_size: 1, pack_unit: "kg" })).toBe(1.85);
    expect(baseQuantity(2, 12, { pack_size: 700, pack_unit: "ml" })).toBe(16.8);
    expect(baseQuantity(null, 1, { pack_size: 1, pack_unit: "kg" })).toBeNull();
    expect(baseQuantity(1, null, { pack_size: 1, pack_unit: "kg" })).toBeNull();
  });
});

describe("matching a line", () => {
  const ds = supplierDS();

  it("exact item code on an ingredient from this supplier matches by code", () => {
    const m = buildMatcher(baseCtx(), ds, "Daniel Street").match({ item_code: "15026", description: "Kingfish fillets skin on wing off per kg" });
    expect(m).toMatchObject({ state: "matched", method: "code" });
    expect(m.ingredient?.id).toBe("ing-kingfish");
  });

  it("an ordering product code wins and brings its ingredient", () => {
    const m = buildMatcher(baseCtx(), ds, "Daniel Street").match({ item_code: "15056", description: "Humpty Doo Barramundi fillets per kg" });
    expect(m.state).toBe("matched");
    expect(m.product?.id).toBe("prod-barra");
    expect(m.ingredient?.id).toBe("ing-barra");
  });

  it("an ordering product only counts when its supplier name matches the invoice supplier", () => {
    const other = prod({ id: "p2", name: "Other", supplier_item_code: "777", supplier_name: "Someone Else" });
    const ctx = baseCtx({ products: [other] });
    expect(buildMatcher(ctx, ds, "Daniel Street").match({ item_code: "777", description: "x" }).state).toBe("unmatched");
    const sameName = prod({ id: "p3", name: "Other", supplier_item_code: "777", supplier_name: "DANIEL STREET FISH MARKET PTY LTD" });
    expect(buildMatcher(baseCtx({ products: [sameName] }), ds, "Daniel Street").match({ item_code: "777", description: "x" }).product?.id).toBe("p3");
  });

  it("an ordering product of another venue is ignored", () => {
    const elsewhere = { ...PROD_BARRA, id: "prod-elsewhere", venue_id: CHIOBU };
    const ctx = baseCtx({ products: [elsewhere], ingredients: [] });
    expect(buildMatcher(ctx, ds, "Daniel Street").match({ item_code: "15056", description: "x" }).state).toBe("unmatched");
  });

  it("an ingredient code must belong to this supplier", () => {
    const stranger = ing({ id: "ing-x", name: "Stranger", supplier_id: 99, supplier_code: "15026" });
    const ctx = baseCtx({ ingredients: [stranger] });
    expect(buildMatcher(ctx, ds, "Daniel Street").match({ item_code: "15026", description: "x" }).state).toBe("unmatched");
  });

  it("a saved match by description matches as an alias, with its packs", () => {
    const ctx = baseCtx({ maps: diabloMaps() });
    const m = buildMatcher(ctx, supplierDiablo(), "Diablo Co").match({ item_code: null, description: "Lychee Liqueur 700ml Bottle" });
    expect(m).toMatchObject({ state: "matched", method: "alias", mapId: "map-lychee", mapPacks: 1 });
    expect(m.ingredient?.id).toBe("ing-lychee");
  });

  it("a saved match by code reads as a code match and beats an ingredient code", () => {
    const map = mapRow({ id: "m1", supplier_id: SUP_DS, item_code: "15026", ingredient_id: "ing-barra", packs_per_unit: 2 });
    const m = buildMatcher(baseCtx({ maps: [map] }), ds, "x").match({ item_code: "15026", description: "x" });
    expect(m).toMatchObject({ state: "matched", method: "code", mapId: "m1", mapPacks: 2 });
    expect(m.ingredient?.id).toBe("ing-barra");
  });

  it("a venue-specific saved match beats an all-venue one", () => {
    const all = mapRow({ id: "all", supplier_id: SUP_DS, item_code: "5", ingredient_id: "ing-kingfish" });
    const mine = mapRow({ id: "mine", supplier_id: SUP_DS, venue_id: DRIFT, item_code: "5", ingredient_id: "ing-barra" });
    const m = buildMatcher(baseCtx({ maps: [all, mine] }), ds, "x").match({ item_code: "5", description: "x" });
    expect(m.mapId).toBe("mine");
    // another venue's saved match is ignored altogether
    const theirs = mapRow({ id: "theirs", supplier_id: SUP_DS, venue_id: CHIOBU, item_code: "5", ingredient_id: "ing-barra" });
    expect(buildMatcher(baseCtx({ maps: [theirs] }), ds, "x").match({ item_code: "5", description: "x" }).state).toBe("unmatched");
  });

  it("two saved matches for one code that disagree are ambiguous, with options", () => {
    const a = mapRow({ id: "a", supplier_id: SUP_DS, item_code: "5", ingredient_id: "ing-kingfish" });
    const b = mapRow({ id: "b", supplier_id: SUP_DS, item_code: "5", ingredient_id: "ing-barra" });
    const m = buildMatcher(baseCtx({ maps: [a, b] }), ds, "x").match({ item_code: "5", description: "x" });
    expect(m.state).toBe("ambiguous");
    expect(m.options).toHaveLength(2);
  });

  it("a rejected match removes that candidate for good, from saved matches and from codes", () => {
    const reject = mapRow({ id: "r", supplier_id: SUP_DS, item_code: "15026", ingredient_id: "ing-kingfish", rejected: true });
    const m = buildMatcher(baseCtx({ maps: [reject] }), ds, "x").match({ item_code: "15026", description: "Kingfish" });
    expect(m.state).toBe("unmatched");
    expect(m.options.some((o) => o.ingredient?.id === "ing-kingfish")).toBe(false);
    // rejected by description
    const rejDesc = mapRow({ id: "rd", supplier_id: SUP_DS, desc_key: descKey("Mystery fish"), ingredient_id: "ing-kingfish", rejected: true });
    const positive = mapRow({ id: "p", supplier_id: SUP_DS, desc_key: descKey("Mystery fish"), ingredient_id: "ing-kingfish" });
    expect(buildMatcher(baseCtx({ maps: [positive, rejDesc] }), ds, "x").match({ item_code: null, description: "Mystery fish" }).state).toBe("unmatched");
    // a rejection is only about that target: another target still matches
    const other = mapRow({ id: "o", supplier_id: SUP_DS, item_code: "15026", ingredient_id: "ing-barra" });
    expect(buildMatcher(baseCtx({ maps: [reject, other] }), ds, "x").match({ item_code: "15026", description: "x" }).ingredient?.id).toBe("ing-barra");
  });

  it("never matches on a fuzzy name alone, but offers suggestions", () => {
    const m = buildMatcher(baseCtx(), ds, "x").match({ item_code: null, description: "Kingfish fillets skin on wing off per kg" });
    expect(m.state).toBe("unmatched");
    expect(m.ingredient).toBeNull();
    expect(m.options[0].ingredient?.id).toBe("ing-kingfish");
    expect(m.options.length).toBeLessThanOrEqual(5);
  });

  it("gives no suggestions when nothing shares a word", () => {
    expect(buildMatcher(baseCtx(), ds, "x").match({ item_code: null, description: "Zzzz widgets" }).options).toEqual([]);
  });

  it("a new supplier has no saved matches or ingredient codes, only products by supplier name", () => {
    const ctx = baseCtx({ maps: [mapRow({ id: "m", supplier_id: SUP_DS, item_code: "15026", ingredient_id: "ing-kingfish" })] });
    expect(buildMatcher(ctx, null, "Brand New").match({ item_code: "15026", description: "x" }).state).toBe("unmatched");
  });

  it("two active products with one code are ambiguous", () => {
    const a = prod({ id: "pa", name: "A", supplier_item_code: "9", supplier_name: "Daniel Street Fish Market" });
    const b = prod({ id: "pb", name: "B", supplier_item_code: "9", supplier_name: "Daniel Street Fish Market" });
    expect(buildMatcher(baseCtx({ products: [a, b] }), ds, "x").match({ item_code: "9", description: "x" }).state).toBe("ambiguous");
    // an inactive twin does not make it ambiguous
    expect(buildMatcher(baseCtx({ products: [a, { ...b, active: false }] }), ds, "x").match({ item_code: "9", description: "x" }).product?.id).toBe("pa");
  });

  it("a saved match pointing at something deleted is skipped", () => {
    const gone = mapRow({ id: "g", supplier_id: SUP_DS, item_code: "15026", ingredient_id: "ing-deleted" });
    const m = buildMatcher(baseCtx({ maps: [gone] }), ds, "x").match({ item_code: "15026", description: "x" });
    // falls through to the ingredient code
    expect(m).toMatchObject({ state: "matched", method: "code" });
    expect(m.ingredient?.id).toBe("ing-kingfish");
  });

  it("uses the fixtures consistently", () => {
    expect([ING_KINGFISH, ING_BARRA, ING_GINGER, ING_LYCHEE]).toHaveLength(4);
  });
});
