import { handleProcess } from "@/lib/invoice-handlers";
import { defaultDeps } from "@/lib/invoice-deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/invoices/process: runs one bounded step of the invoice reader (secret header, no user session). See lib/invoice-pipeline.ts. */
export async function POST(request: Request) {
  return handleProcess(request, { getDeps: () => defaultDeps() });
}
