import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

/**
 * DEMO MODE ONLY. Serves the local visual-QA fixture (.demo/data.json, gitignored client pricing data).
 * Returns 404 unless NEXT_PUBLIC_DEMO=1 — never enable that flag in production.
 */
export async function GET() {
  if (process.env.NEXT_PUBLIC_DEMO !== "1") return new NextResponse("Not found", { status: 404 });
  try {
    const dir = process.env.DEMO_DATA_DIR || path.join(process.cwd(), ".demo");
    const json = await readFile(path.join(dir, "data.json"), "utf8");
    return new NextResponse(json, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
