/**
 * The approved-list check that runs BEFORE a sign-in link is requested (Troy, 23 Nov 2026).
 *
 * Supabase sends sign-in emails from one shared sender with a small hourly limit, and it sends to any address it is given (it even
 * created an account for a typo, moniqur@mscr.net.au, on 9 Nov). Checking the address against `cost_allowed_users` first means a typo
 * or a stranger never uses up a send that someone real needs. Pure rules only: the route reads the list, the login form asks the route.
 */
export const NOT_APPROVED_MESSAGE = "That email is not on the approved list. Check the spelling, or ask Troy or Abbey to add you.";

/** trimmed and lower case, the way Supabase and `cost_is_allowed()` compare addresses */
export function normaliseEmail(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

/** a plain shape check (one @, something either side, no spaces); the real test is the approved list */
export function looksLikeEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** whether the address is on the approved list, ignoring capitals and spaces */
export function isApprovedEmail(rows: readonly { email: string | null }[], email: unknown): boolean {
  const want = normaliseEmail(email);
  if (!want) return false;
  return rows.some((r) => normaliseEmail(r.email) === want);
}
