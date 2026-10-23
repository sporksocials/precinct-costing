import { handleUploadUrl } from "@/lib/invoice-handlers";
import { supabaseIngestStore } from "@/lib/invoice-repo";
import { getServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/invoices/upload-url: the scanner script asks where to put a PDF (secret header, no user session). See lib/invoice-handlers.ts. */
export async function POST(request: Request) {
  return handleUploadUrl(request, { getStore: () => supabaseIngestStore(getServiceClient()) });
}
