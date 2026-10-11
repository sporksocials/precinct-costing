import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { needsDetails } from "@/lib/ordering-count-ui";

describe("needsDetails", () => {
  it("is true for a note that starts Needs more details, in any case", () => {
    expect(needsDetails({ notes: "Needs more details: brand, supplier and bottle size." })).toBe(true);
    expect(needsDetails({ notes: "  needs MORE details" })).toBe(true);
  });
  it("is false for no note, an ordinary note, or a note that only mentions it", () => {
    expect(needsDetails({ notes: null })).toBe(false);
    expect(needsDetails({ notes: "" })).toBe(false);
    expect(needsDetails({ notes: "Supplier to confirm." })).toBe(false);
    expect(needsDetails({ notes: "See also: needs more details" })).toBe(false);
  });
});

describe("the count row", () => {
  const src = readFileSync(join(__dirname, "..", "components/ordering/count/count-row.tsx"), "utf8");
  it("shows a 44px link to the product setup page when details are needed", () => {
    expect(src).toContain("needsDetails(product)");
    expect(src).toContain("detailsHref");
    expect(src).toMatch(/needs-details-link[\s\S]{0,120}min-h-\[44px\]/);
  });
});
