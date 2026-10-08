import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { checkName, parseRequest } from "@/lib/name-check";

export const dynamic = "force-dynamic";
// the model gets 5 seconds (lib/name-check.ts); a name check never needs more
export const maxDuration = 10;

/**
 * POST /api/name-check: proposes the same name with only its spelling and capitals fixed.
 *
 * Body: { name: string (80 characters at most), kind: "menu_item" | "drink" | "ingredient" | "prep" | "beer", words?: string[] (up to 150 known words) }
 * Answer: { changed: false, why? } or { changed: true, corrected, reason }. A reply from the model that fails any check
 * (more than spelling changed, too long, an em or en dash, not JSON) is simply { changed: false, why: "bad_reply_..." }.
 *
 * It only proposes: nothing is saved here. There is no built-in fallback to build, because the automatic tidy and the
 * vocabulary check run in the browser; a failure here is silent for the person.
 *
 * Only for signed-in people on the allow-list (middleware already sends everyone else to /login; this checks again so
 * the route can never be called anonymously, since a call costs money). Demo mode (local visual QA) has no sign-in.
 * The key is read from ANTHROPIC_API_KEY on the server only and is never returned or logged.
 */
async function allowed(): Promise<boolean> {
  if (process.env.NEXT_PUBLIC_DEMO === "1") return true;
  try {
    const sb = getSupabaseServer();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return false;
    const { data, error } = await sb.rpc("cost_is_allowed");
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!(await allowed())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const input = parseRequest(body);
  if (!input) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  try {
    const result = await checkName(input);
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ changed: false, why: "error" }, { headers: { "cache-control": "no-store" } });
  }
}
