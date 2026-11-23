import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareSentence, compareSuppliers, switchNote, SWITCH_PCT } from "@/lib/supplier-compare";

/**
 * Owners' rule (15 Oct 2026): order from Star unless another supplier is 10% cheaper; note it when this price is 10% over.
 * "Other Supplier" was taken off every screen on 23 Nov 2026 (one card per product, Troy's decision): the rule and its
 * wording are kept here, parked, and the last test pins that no screen reaches them.
 */
describe("the 10% rule", () => {
  it("is 10%, and 'over' means this price against the other price", () => {
    expect(SWITCH_PCT).toBe(0.1);
    expect(compareSuppliers(110, 100)).toMatchObject({ flagged: true, diff: 10 });
    expect(compareSuppliers(109.9, 100)?.flagged).toBe(false);
    expect(compareSuppliers(124.5, 123.41)?.flagged).toBe(false); // Chingu, Star against Paramount
    expect(compareSuppliers(69, 71.49)?.flagged).toBe(false); // Toki, Star is the cheaper
  });
  it("says nothing without two real prices", () => {
    expect(compareSuppliers(null, 100)).toBeNull();
    expect(compareSuppliers(100, null)).toBeNull();
    expect(compareSuppliers(0, 100)).toBeNull();
    expect(switchNote({ price: 100, otherName: "Paramount", otherPrice: null })).toBeNull();
  });
});

describe("the order line note", () => {
  it("appears only when the other supplier is 10% or more cheaper", () => {
    expect(switchNote({ price: 124.5, otherName: "Paramount", otherPrice: 110, unit: "carton" })).toBe("Paramount is $14.50 a carton cheaper. This price is 13% over theirs. The owners' rule is to look at switching at 10% over.");
    expect(switchNote({ price: 124.5, otherName: "Paramount", otherPrice: 123.41, unit: "carton" })).toBeNull();
    expect(switchNote({ price: 69, otherName: "Paramount", otherPrice: 71.49, unit: "bottle" })).toBeNull();
  });
  it("uses no dashes a supplier or person would read as machine wording", () => {
    const t = switchNote({ price: 200, otherName: "Paramount", otherPrice: 100, unit: "keg" }) ?? "";
    expect(t).not.toMatch(/[—–]/);
  });
});

describe("the sentence that says what to do", () => {
  it("always says what to do", () => {
    expect(compareSentence({ price: 124.5, otherName: "Paramount", otherPrice: 123.41, unit: "carton" })).toBe("Paramount is $1.09 a carton cheaper, but this price is only 1% over theirs. Stay with this supplier (the rule is 10% over).");
    expect(compareSentence({ price: 69, otherName: "Paramount", otherPrice: 71.49, unit: "bottle" })).toBe("This price is $2.49 a bottle under Paramount (3%). Stay with this supplier.");
    expect(compareSentence({ price: 110, otherName: "Paramount", otherPrice: 100, unit: "bottle" })).toContain("look at switching");
    expect(compareSentence({ price: 100, otherName: "Paramount", otherPrice: 100 })).toBe("The same price as Paramount. Stay with this supplier.");
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("is parked: no screen shows or sets another supplier's price, and the columns stay in the database", () => {
    for (const f of ["components/ordering/orders/line-editor.tsx", "components/ordering/orders/order-card.tsx", "lib/ordering-orders-ui.ts", "app/(app)/ordering/[venue]/setup/products/[id]/page.tsx", "app/(app)/ordering/[venue]/setup/products/page.tsx", "components/ingredient-ordering.tsx"]) {
      expect(read(f), f).not.toMatch(/switchNote|supplier-compare|Other Supplier|alt_supplier_name|alt_price_inc_gst/);
    }
    expect(read("supabase/schema.sql")).toContain("ordering_products_alt_price_chk");
  });
});
