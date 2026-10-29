import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// One supplier list (29 Oct 2026): an ordering product belongs to the invoice's supplier by the supplier link, names are the fallback.
describe("invoice matching uses the one supplier list", () => {
  const match = readFileSync("lib/invoice-match.ts", "utf8");
  const context = readFileSync("lib/invoice-context.ts", "utf8");
  it("compares the product's supplier with the invoice supplier's cost supplier before any name", () => {
    expect(match).toContain("p.supplier_cost_id === supplier.cost_supplier_id");
  });
  it("loads each ordering supplier's cost_supplier_id", () => {
    expect(context).toContain('"id,name,cost_supplier_id"');
    expect(context).toContain("supplier_cost_id:");
  });
});
