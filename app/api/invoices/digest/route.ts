import { NextResponse } from "next/server";
import { checkSecret, cleanIds, DigestConfigError, getServiceClient, notifyDocuments } from "@/lib/invoice-digest-data";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Per-run Slack messages are OFF (Troy, 25 Oct 2026: "way too many messages, I only want one a week on a Friday at 8am"). The
 * scanner script used to post here after every processing run; that now answers "nothing sent" and posts nothing. The weekly
 * review is a separate message (see the weekly route/mode). GET still previews text and never posts.
 */
const PER_RUN_SLACK = false;

/**
 * POST /api/invoices/digest { documentIds: string[] }: builds the Slack digest for those documents (one message per venue, none
 * for a quiet run) and, when INVOICE_SLACK_WEBHOOK_URL is set, posts it and records it in invoice_digests. A document already
 * announced is not announced again. Answer: { sent, text } (text is null for a quiet run) plus the per venue messages.
 *
 * GET /api/invoices/digest?documentIds=a,b: the same text as a preview. Posts nothing and records nothing.
 *
 * Both need the shared secret in the `x-invoice-secret` header (the same one the scanner script uses); there is no signed-in
 * user. The pipeline normally calls `notifyDocuments` directly instead of this route.
 */
function denied(check: ReturnType<typeof checkSecret>): NextResponse | null {
  if (check === "ok") return null;
  if (check === "not_configured") return NextResponse.json({ error: "Invoice intake is not set up yet." }, { status: 503 });
  return NextResponse.json({ error: "Not allowed" }, { status: 401 });
}

async function run(ids: string[], dryRun: boolean): Promise<NextResponse> {
  try {
    const result = await notifyDocuments(getServiceClient(), ids, { dryRun });
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof DigestConfigError) return NextResponse.json({ error: e.message }, { status: 503 });
    return NextResponse.json({ error: "Could not build the digest." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const no = denied(checkSecret(request.headers.get("x-invoice-secret")));
  if (no) return no;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const ids = cleanIds((body as { documentIds?: unknown } | null)?.documentIds, 200);
  if (!ids || ids.length === 0) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  if (!PER_RUN_SLACK) return NextResponse.json({ sent: false, text: null, messages: [], alreadyAnnounced: 0, note: "Per-run Slack messages are switched off." }, { headers: { "cache-control": "no-store" } });
  return run(ids, false);
}

export async function GET(request: Request) {
  const no = denied(checkSecret(request.headers.get("x-invoice-secret")));
  if (no) return no;
  const raw = new URL(request.url).searchParams.get("documentIds") ?? "";
  const ids = cleanIds(raw.split(",").filter(Boolean), 200);
  if (!ids || ids.length === 0) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  return run(ids, true);
}
