import { describe, expect, it } from "vitest";
import { editDistance, indexDoc, search, type SearchDoc } from "@/lib/search";

const docs = [
  { kind: "ingredient", id: "1", title: "Chicken Thigh", sub: "", href: "" },
  { kind: "ingredient", id: "2", title: "Chickpea", sub: "", href: "" },
  { kind: "item", id: "3", title: "Bacon Bene", sub: "", href: "" },
  { kind: "ingredient", id: "4", title: "Bacon", sub: "", href: "", extra: "Cotton Tree Meats" },
  { kind: "item", id: "5", title: "Beef & Bacon Burger", sub: "", href: "" },
  { kind: "ingredient", id: "6", title: "Thickened Cream", sub: "", href: "" },
] satisfies SearchDoc[];
const idx = docs.map(indexDoc);

describe("search", () => {
  it("tolerates typos", () => {
    const hits = search(idx, "chiken");
    expect(hits[0].doc.title).toBe("Chicken Thigh");
  });
  it("ranks exact title first", () => {
    expect(search(idx, "bacon")[0].doc.title).toBe("Bacon");
  });
  it("requires every token", () => {
    const hits = search(idx, "bacon bene");
    expect(hits[0].doc.title).toBe("Bacon Bene");
    expect(hits.some((h) => h.doc.title === "Bacon")).toBe(false);
  });
  it("matches extra fields", () => {
    expect(search(idx, "cotton").map((h) => h.doc.id)).toEqual(["4"]);
  });
  it("handles prefixes while typing", () => {
    expect(search(idx, "chi").length).toBeGreaterThanOrEqual(2);
  });
  it("computes Damerau distance", () => {
    expect(editDistance("chiken", "chicken")).toBe(1);
    expect(editDistance("bacno", "bacon")).toBe(1);
    expect(editDistance("abc", "xyz", 1)).toBe(2);
  });
});
