/**
 * People on the Who Can Sign In list. Only the owner gives them first names (Troy, 4 Oct 2026), so the change log, price
 * history and ignored alerts can say "Matt" instead of an email address. Without a name the part before the @ is used.
 */
import type { AllowedUser } from "./types";

/** The one login that may set names. The database enforces the same rule (cost_allowed_users_name_guard). */
export const OWNER_EMAIL = "hello@sporksocials.com.au";

export function isOwnerEmail(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase() === OWNER_EMAIL;
}

export const NAME_MAX = 40;

/** A first name as typed, tidied: trimmed, spaces collapsed, letters, spaces, hyphens and apostrophes only. Null when empty. */
export function cleanName(raw: string | null | undefined): string | null {
  const t = (raw ?? "").replace(/[^\p{L}\p{M} '’-]/gu, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX).trim();
  return t || null;
}

/** "Matt" for a listed person with a name, else the part before the @ capitalised ("Chef"), else null when there is no email. */
export function personName(email: string | null | undefined, users: readonly Pick<AllowedUser, "email" | "display_name">[]): string | null {
  const e = (email ?? "").trim();
  if (!e) return null;
  const hit = users.find((u) => u.email.toLowerCase() === e.toLowerCase());
  const name = cleanName(hit?.display_name);
  if (name) return name;
  const local = e.split("@")[0];
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : e;
}
