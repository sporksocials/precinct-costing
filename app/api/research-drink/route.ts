import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { parseRequest, researchDrink, researchWhy, type ResearchEnv } from "@/lib/research-drink";

export const dynamic = "force-dynamic";
// the research may search the web up to 4 times; lib/research-drink.ts stops itself at 50 seconds, inside this limit
// (60 seconds is allowed on every Vercel plan)
export const maxDuration = 60;

/**
 * POST /api/research-drink: researches a NEW cocktail or mocktail on the web and answers with Research Notes to file.
 *
 * Body: { itemName, category: "Cocktail" | "Mocktail", glass, lines: [{ id?, name, qty, unit, prep? }], method: string[],
 *         garnish: string[], existingTitles: string[] }
 * Answer: { notes: [{ kind, title, body, changes, method_step, method_replaces, sources }], searches, dropped, trimmed }
 *      or { error, reason } with 502 (the research failed), 503 (not switched on) or 504 (timed out).
 *
 * It only proposes: nothing is saved here and no recipe is touched. Every source link was returned by the search itself.
 *
 * Only for signed-in people on the allow-list (middleware already sends everyone else to /login; this checks again so
 * the route can never be called anonymously, since a call costs money). Demo mode (local visual QA) has no sign-in.
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
    const r = await researchDrink(input, process.env as ResearchEnv);
    if (!r.ok) {
      const status = r.reason === "timeout" ? 504 : r.reason === "no_key" ? 503 : 502;
      return NextResponse.json({ error: researchWhy(r.reason), reason: r.reason }, { status, headers: { "cache-control": "no-store" } });
    }
    return NextResponse.json({ notes: r.notes, searches: r.searches, dropped: r.dropped, trimmed: r.trimmed }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: researchWhy("server"), reason: "server" }, { status: 500 });
  }
}
