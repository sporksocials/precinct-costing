import { describe, expect, it } from "vitest";
import { clashMessage, findClash, nameKey } from "@/lib/rename";

const rows = [
  { id: "a", name: "Chicken Thigh" },
  { id: "b", name: "Burger" },
];

describe("rename clash check", () => {
  it("ignores capitals and extra spaces", () => {
    expect(nameKey("  Chicken   THIGH ")).toBe("chicken thigh");
    expect(findClash("chicken  thigh", rows, "z")?.id).toBe("a");
  });
  it("a record never clashes with itself", () => {
    expect(findClash("Chicken Thigh", rows, "a")).toBeNull();
  });
  it("an empty name clashes with nothing", () => {
    expect(findClash("   ", rows, "z")).toBeNull();
  });
  it("words the problem plainly", () => {
    expect(clashMessage("ingredient", rows[0])).toBe("Another ingredient is already called Chicken Thigh. Pick a different name.");
    expect(clashMessage("dish", rows[1], "Drift")).toBe("Another dish at Drift is already called Burger. Pick a different name.");
  });
});
