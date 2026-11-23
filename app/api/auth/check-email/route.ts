import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import { isApprovedEmail, looksLikeEmail, normaliseEmail } from "@/lib/login-check";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * POST /api/auth/check-email: is this email on the approved list? Body { email }. Answer { allowed: true | false }.
 *
 * Public on purpose (the person is not signed in yet; middleware lists it with the login page). It answers only yes or no and
 * returns nothing else from the list. The login form calls it before asking Supabase to email a sign-in link, so a typo or a stranger
 * never uses one of the shared hourly sends (lib/login-check.ts). It reads the list with the server-only service client.
 *
 * If it cannot answer (a server or database error) it says so with a 500 and the form carries on and sends the link anyway: a broken
 * check must never lock a real person out, and the app still refuses anyone not on the list once they are signed in.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const email = normaliseEmail((body as { email?: unknown } | null)?.email);
  if (!looksLikeEmail(email)) return NextResponse.json({ allowed: false });
  try {
    const sb = getServiceClient();
    const { data, error } = await sb.from("cost_allowed_users").select("email");
    if (error) throw error;
    return NextResponse.json({ allowed: isApprovedEmail(data ?? [], email) });
  } catch {
    return NextResponse.json({ error: "Could not check" }, { status: 500 });
  }
}
