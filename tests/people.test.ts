import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cleanName, isOwnerEmail, NAME_MAX, OWNER_EMAIL, personName } from "@/lib/people";

const users = [
  { email: "hello@sporksocials.com.au", display_name: "Troy" },
  { email: "matt@mscr.net.au", display_name: "Matt" },
  { email: "chef@driftbar.com.au", display_name: null },
  { email: "orders@driftbar.com.au" },
];

describe("personName", () => {
  it("uses the first name when one is set, whatever the email's case", () => {
    expect(personName("matt@mscr.net.au", users)).toBe("Matt");
    expect(personName("MATT@mscr.net.au", users)).toBe("Matt");
    expect(personName("hello@sporksocials.com.au", users)).toBe("Troy");
  });
  it("falls back to the capitalised part before the @", () => {
    expect(personName("chef@driftbar.com.au", users)).toBe("Chef");
    expect(personName("orders@driftbar.com.au", users)).toBe("Orders");
    expect(personName("someone@else.com", users)).toBe("Someone");
  });
  it("is null when there is no email", () => {
    expect(personName(null, users)).toBeNull();
    expect(personName("  ", users)).toBeNull();
    expect(personName(undefined, [])).toBeNull();
  });
  it("ignores a stored name that is only junk", () => {
    expect(personName("matt@mscr.net.au", [{ email: "matt@mscr.net.au", display_name: "  123  " }])).toBe("Matt");
  });
});

describe("cleanName", () => {
  it("keeps a plain first name", () => {
    expect(cleanName("Monique")).toBe("Monique");
    expect(cleanName("  Mary  Ann ")).toBe("Mary Ann");
    expect(cleanName("Jean-Luc")).toBe("Jean-Luc");
    expect(cleanName("O’Brien")).toBe("O’Brien");
    expect(cleanName("Zoë")).toBe("Zoë");
  });
  it("drops digits, symbols and markup, and caps the length", () => {
    expect(cleanName("<b>Bob</b>")).toBe("bBobb");
    expect(cleanName("a1b2")).toBe("ab");
    expect(cleanName("x".repeat(100))?.length).toBe(NAME_MAX);
  });
  it("is null for empty input", () => {
    expect(cleanName("")).toBeNull();
    expect(cleanName("   ")).toBeNull();
    expect(cleanName("123")).toBeNull();
    expect(cleanName(null)).toBeNull();
  });
});

describe("the owner rule", () => {
  it("only hello@sporksocials.com.au is the owner", () => {
    expect(OWNER_EMAIL).toBe("hello@sporksocials.com.au");
    expect(isOwnerEmail("hello@sporksocials.com.au")).toBe(true);
    expect(isOwnerEmail(" Hello@SporkSocials.com.au ")).toBe(true);
    expect(isOwnerEmail("matt@mscr.net.au")).toBe(false);
    expect(isOwnerEmail(null)).toBe(false);
  });
  it("the database guard (migration and schema.sql) names the same owner and refuses everyone else", () => {
    const mig = readFileSync("supabase/migrations/20261004220000_allowed_user_names.sql", "utf8");
    const schema = readFileSync("supabase/schema.sql", "utf8");
    for (const sql of [mig, schema]) {
      expect(sql).toContain(`'${OWNER_EMAIL}'`);
      expect(sql).toContain("Only the owner can change names");
      expect(sql).toContain("Only the owner can set names");
      expect(sql).toContain("before insert or update on public.cost_allowed_users");
    }
    expect(schema).toContain("display_name text");
  });
  it("history screens show names through the shared helper, not by splitting the email themselves", () => {
    for (const f of ["components/ingredient-history.tsx", "components/alert-parts.tsx", "components/editor/price-history.tsx", "app/(app)/change-log/page.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src).toContain("usePersonName");
      expect(src).not.toMatch(/split\("@"\)/);
    }
  });
});
