import { describe, expect, it } from "vitest";
import { suggestCopyName } from "@/lib/duplicate-name";

describe("suggestCopyName", () => {
  it("adds Copy", () => {
    expect(suggestCopyName("Margherita Pizza", [])).toBe("Margherita Pizza Copy");
  });
  it("counts on when the name is taken, ignoring capitals and spacing", () => {
    expect(suggestCopyName("Margherita Pizza", ["margherita  pizza copy"])).toBe("Margherita Pizza Copy 2");
    expect(suggestCopyName("Margherita Pizza", ["Margherita Pizza Copy", "Margherita Pizza Copy 2"])).toBe("Margherita Pizza Copy 3");
  });
  it("never reads Copy Copy", () => {
    expect(suggestCopyName("Margherita Pizza Copy", ["Margherita Pizza Copy"])).toBe("Margherita Pizza Copy 2");
    expect(suggestCopyName("Margherita Pizza Copy 2", ["Margherita Pizza Copy", "Margherita Pizza Copy 2"])).toBe("Margherita Pizza Copy 3");
  });
});
