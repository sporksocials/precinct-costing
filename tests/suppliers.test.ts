import { describe, expect, it } from "vitest";
import { cleanSupplierName, findSupplier, supplierKey } from "@/lib/suppliers";

describe("cleanSupplierName", () => {
  it("tidies spaces and capitals like every other name", () => {
    expect(cleanSupplierName("  bidfood   ")).toBe("Bidfood");
    expect(cleanSupplierName("PARAMOUNT LIQUOR")).toBe("Paramount Liquor");
    expect(cleanSupplierName("   ")).toBe("");
  });
});

describe("findSupplier", () => {
  const list = [
    { id: 1, name: "Bidfood" },
    { id: 2, name: "Paramount Liquor" },
    { id: 3, name: "Star Liquor Direct" },
  ];
  it("finds the same supplier ignoring capitals, spaces and punctuation", () => {
    expect(findSupplier(list, "bidfood")?.id).toBe(1);
    expect(findSupplier(list, "Paramount  Liquor")?.id).toBe(2);
    expect(findSupplier(list, "star-liquor direct")?.id).toBe(3);
  });
  it("treats Pty Ltd as noise", () => {
    expect(findSupplier(list, "Bidfood Pty Ltd")?.id).toBe(1);
    expect(supplierKey("Bid Food Pty. Ltd.")).toBe("bidfood");
  });
  it("returns nothing for a new supplier or an empty name", () => {
    expect(findSupplier(list, "Mega Chef")).toBeUndefined();
    expect(findSupplier(list, "  ")).toBeUndefined();
  });
});
