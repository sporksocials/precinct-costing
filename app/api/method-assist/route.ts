import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { assist, parseRequest } from "@/lib/method-assist";
import { TidyError } from "@/lib/method-style";

export const dynamic = "force-dynamic";

/**
 * POST /api/method-assist: tidies one method step into the house style and says where it goes.
 *
 * Body: { itemName, category, glass, lines: [{name, qty, unit}], method: string[], mode: "step" | "answer", text,
 *         replaces?, noteTitle? }
 * Answer: { ops: [{ op: "insert" | "replace", index, text }], source: "ai" | "builtin" }
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
    const result = await assist(input);
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof TidyError) return NextResponse.json({ error: e.message }, { status: 422 });
    return NextResponse.json({ error: "Could not tidy that step" }, { status: 500 });
  }
}
