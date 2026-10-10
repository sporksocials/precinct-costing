import { describe, expect, it } from "vitest";
import { isNavigationScroll, shouldRestore, withPosition } from "@/lib/scroll-memory";

describe("scroll memory", () => {
  it("keeps a position per address and makes the newest last", () => {
    let a = withPosition({}, "/ingredients", 1200);
    a = withPosition(a, "/menu?venue=greedy", 300);
    a = withPosition(a, "/ingredients", 1500);
    expect(Object.keys(a)).toEqual(["/menu?venue=greedy", "/ingredients"]);
    expect(a["/ingredients"]).toBe(1500);
  });
  it("forgets a place at the top and never stores junk", () => {
    expect(withPosition({ "/menu": 400 }, "/menu", 0)).toEqual({});
    expect(withPosition({}, "/menu", Number.NaN)).toEqual({});
    expect(withPosition({}, "/menu", -5)).toEqual({});
  });
  it("is capped, dropping the oldest", () => {
    let a: Record<string, number> = {};
    for (let i = 0; i < 50; i++) a = withPosition(a, `/p${i}`, 100 + i, 40);
    expect(Object.keys(a)).toHaveLength(40);
    expect(a["/p0"]).toBeUndefined();
    expect(a["/p49"]).toBe(149);
  });
  it("ignores the jump to the top that a link press causes, but not a real scroll to the top later", () => {
    expect(isNavigationScroll(0, 100)).toBe(true);
    expect(isNavigationScroll(0, 2000)).toBe(false);
    expect(isNavigationScroll(0, null)).toBe(false);
    expect(isNavigationScroll(300, 100)).toBe(false);
  });
  it("restores on Back, Forward, reload and the back arrow, and not on an ordinary link", () => {
    expect(shouldRestore({ popped: true, backArrow: false })).toBe(true);
    expect(shouldRestore({ popped: false, backArrow: true })).toBe(true);
    expect(shouldRestore({ popped: false, backArrow: false, navType: "reload" })).toBe(true);
    expect(shouldRestore({ popped: false, backArrow: false, navType: "back_forward" })).toBe(true);
    expect(shouldRestore({ popped: false, backArrow: false, navType: "navigate" })).toBe(false);
    expect(shouldRestore({ popped: false, backArrow: false })).toBe(false);
  });
});
