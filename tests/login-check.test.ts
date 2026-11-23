import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOT_APPROVED_MESSAGE, isApprovedEmail, looksLikeEmail, normaliseEmail } from "@/lib/login-check";

const rows = [{ email: "Matt@mscr.net.au" }, { email: "hello@sporksocials.com.au" }, { email: null }];

describe("approved-list rules", () => {
  it("normalises like Supabase does: trimmed, lower case", () => {
    expect(normaliseEmail("  Matt@MSCR.net.au ")).toBe("matt@mscr.net.au");
    expect(normaliseEmail(undefined)).toBe("");
    expect(normaliseEmail(42)).toBe("");
  });
  it("accepts an approved address whatever its capitals or spaces", () => {
    expect(isApprovedEmail(rows, "matt@mscr.net.au")).toBe(true);
    expect(isApprovedEmail(rows, " MATT@mscr.net.au ")).toBe(true);
  });
  it("refuses a typo, a stranger, an empty value and a null row", () => {
    expect(isApprovedEmail(rows, "moniqur@mscr.net.au")).toBe(false);
    expect(isApprovedEmail(rows, "matt@mscr.net.au.evil.com")).toBe(false);
    expect(isApprovedEmail(rows, "")).toBe(false);
    expect(isApprovedEmail(rows, null)).toBe(false);
    expect(isApprovedEmail([{ email: null }], "")).toBe(false);
  });
  it("looksLikeEmail is a shape check only", () => {
    expect(looksLikeEmail("a@b.co")).toBe(true);
    expect(looksLikeEmail("a b@c.com")).toBe(false);
    expect(looksLikeEmail("nope")).toBe(false);
    expect(looksLikeEmail("a@b")).toBe(false);
    expect(looksLikeEmail(`${"a".repeat(250)}@b.co`)).toBe(false);
  });
  it("the message says what to do and has no dashes", () => {
    expect(NOT_APPROVED_MESSAGE).toMatch(/approved list/);
    expect(NOT_APPROVED_MESSAGE).not.toMatch(/[–—]/);
  });
});

const select = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ from: () => ({ select }) }),
}));

describe("POST /api/auth/check-email", () => {
  beforeEach(() => select.mockReset());
  const call = async (body: unknown, raw?: string) => {
    const { POST } = await import("@/app/api/auth/check-email/route");
    return POST(new Request("http://x/api/auth/check-email", { method: "POST", body: raw ?? JSON.stringify(body) }));
  };
  it("says allowed for an approved email and refuses a typo, returning nothing else from the list", async () => {
    select.mockResolvedValue({ data: rows, error: null });
    const yes = await call({ email: "matt@mscr.net.au" });
    expect(await yes.json()).toEqual({ allowed: true });
    const no = await call({ email: "moniqur@mscr.net.au" });
    expect(await no.json()).toEqual({ allowed: false });
  });
  it("refuses a missing or badly shaped email without reading the list", async () => {
    expect(await (await call({})).json()).toEqual({ allowed: false });
    expect(await (await call({ email: "not an email" })).json()).toEqual({ allowed: false });
    expect(select).not.toHaveBeenCalled();
  });
  it("is a 400 for a body that is not JSON, and a 500 (not an answer) when the list cannot be read", async () => {
    expect((await call(null, "{{")).status).toBe(400);
    select.mockResolvedValue({ data: null, error: new Error("db down") });
    const res = await call({ email: "matt@mscr.net.au" });
    expect(res.status).toBe(500);
    expect(await res.json()).not.toHaveProperty("allowed");
  });
});

describe("wiring", () => {
  it("the login form checks the list before it asks Supabase for a link, and carries on if the check fails", () => {
    const src = readFileSync("app/login/login-form.tsx", "utf8");
    expect(src.indexOf("/api/auth/check-email")).toBeGreaterThan(-1);
    expect(src.indexOf("/api/auth/check-email")).toBeLessThan(src.indexOf("signInWithOtp"));
    expect(src).toMatch(/NOT_APPROVED_MESSAGE/);
    expect(src).toMatch(/catch \{[\s\S]{0,80}fall through/);
  });
  it("the check route is open to people who are not signed in yet", () => {
    expect(readFileSync("middleware.ts", "utf8")).toMatch(/PUBLIC_PATHS = \[[^\]]*"\/api\/auth\/check-email"/);
  });
});
