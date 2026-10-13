import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasMark } from "@/components/brand";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** Venue emblems beside venue names (Troy, 13 Oct 2026). */
describe("venue emblems", () => {
  it("every venue has an emblem file cropped from its own logo, and nothing else gets one", () => {
    for (const slug of ["drift", "chiobu", "greedy", "gelato"]) {
      expect(hasMark(slug)).toBe(true);
      expect(existsSync(join(process.cwd(), `public/brand/mark-${slug}.svg`))).toBe(true);
      expect(existsSync(join(process.cwd(), `public/brand/${slug}.svg`))).toBe(true);
    }
    expect(hasMark("all")).toBe(false);
    expect(hasMark(null)).toBe(false);
    expect(hasMark("someone-else")).toBe(false);
  });
  it("each emblem is the same artwork as the logo with a tighter viewBox", () => {
    for (const slug of ["drift", "chiobu", "greedy", "gelato"]) {
      const full = read(`public/brand/${slug}.svg`);
      const mark = read(`public/brand/mark-${slug}.svg`);
      expect(mark).toMatch(/viewBox="[-\d. ]+"/);
      expect(mark).not.toBe(full);
      expect(mark).toContain("<path"); // the artwork itself, not a redrawn copy
    }
  });
  it("the venue tiles, Home, Menu, Ordering and the venue pickers draw them", () => {
    expect(read("components/venue.tsx")).toContain("<VenueMark");
    expect(read("components/dashboard.tsx")).toContain("<VenueMark");
    expect(read("app/(app)/menu/page.tsx")).toContain("<VenueMark");
    expect(read("app/(app)/ordering/page.tsx")).toContain("<VenueMark");
    expect(read("components/new-recipe.tsx")).toContain("<VenueTag");
  });
  it("the selected venue tile draws a one colour emblem so it never vanishes on the accent fill", () => {
    expect(read("components/venue.tsx")).toMatch(/tone=\{on \? "ink" : "colour"\}/);
  });
});
