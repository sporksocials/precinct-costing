import { describe, expect, it } from "vitest";
import { usableList } from "@/lib/list-memory";

describe("usableList (the back arrow on a record page)", () => {
  it("returns the list as it was left, with the chip, search and sort", () => {
    expect(usableList("/menu?venue=greedy&cat=Food", "/menu", { venue: "greedy" })).toBe(true);
    expect(usableList("/menu?venue=greedy&cat=Food&q=cactus&sort=gp&inactive=1", "/menu", { venue: "greedy" })).toBe(true);
  });
  it("accepts a list that was showing All venues", () => {
    expect(usableList("/menu?cat=Cocktail", "/menu", { venue: "drift" })).toBe(true);
    expect(usableList("/menu", "/menu", { venue: "drift" })).toBe(true);
  });
  it("ignores a list that was filtered to a different venue", () => {
    expect(usableList("/menu?venue=drift&cat=Food", "/menu", { venue: "greedy" })).toBe(false);
  });
  it("needs something remembered, and on the same page", () => {
    expect(usableList(null, "/menu")).toBe(false);
    expect(usableList("/ingredients?cat=Dairy", "/menu")).toBe(false);
  });
  it("keeps Preps and Ingredients apart on /ingredients", () => {
    const preps = { require: { key: "type", value: "preps" } };
    expect(usableList("/ingredients?type=preps&venue=drift&cat=Sauce", "/ingredients", preps)).toBe(true);
    expect(usableList("/ingredients?cat=Dairy", "/ingredients", preps)).toBe(false);
    const ings = { forbid: { key: "type", value: "preps" } };
    expect(usableList("/ingredients?cat=Dairy&q=milk", "/ingredients", ings)).toBe(true);
    expect(usableList("/ingredients?type=preps", "/ingredients", ings)).toBe(false);
  });
});
