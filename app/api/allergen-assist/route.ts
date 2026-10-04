import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { assistAllergens, parseRequest } from "@/lib/allergen-assist";

export const dynamic = "force-dynamic";
// a batch of 20 ingredients may wait up to 20 seconds for the smart check before the built-in one answers
export const maxDuration = 30;

/**
 * POST /api/allergen-assist: proposes the allergens and animal products an ingredient contains, each with a reason.
 *
 * Body: { ingredients: [{ key, name, category, description?, allergens: string[], dietFlags: string[] }] } (one to 20),
 *       or a single ingredient at the top level.
 * Answer: { items: [{ key, allergens: [{ id, reason }], diet: [{ flag, reason }] }], source: "ai" | "builtin", fallback? }
 *
 * It only proposes: nothing is saved here, and nothing ever marks an ingredient as reviewed.
 *
 * Only for signed-in people on the allow-list (middleware already sends everyone else to /login; this checks again so
 * the route can never be called anonymously, since a call may cost money). Demo mode (local visual QA) has no sign-in.
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
    const result = await assistAllergens(input);
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not suggest allergens" }, { status: 500 });
  }
}
