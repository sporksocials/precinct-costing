import { NextResponse } from "next/server";
import { checkSecret, cleanIds, DigestConfigError, getServiceClient, notifyDocuments, sendWeeklyReview } from "@/lib/invoice-digest-data";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Per-run Slack messages are OFF (Troy, 25 Oct 2026: "way too many messages, I only want one a week on a Friday at 8am"). The
 * scanner script used to post here after every processing run; that now answers "nothing sent" and posts nothing. The ONE Slack
 * message is the weekly review below.
 */
const PER_RUN_SLACK = false;

/**
 * POST /api/invoices/digest { mode: "weekly" }: builds the weekly review (the 7 days up to now, all venues in one message) and,
 * when INVOICE_SLACK_WEBHOOK_URL is set, posts it to Slack and records it in invoice_digests. The scanner script calls this on
 * Friday around 8am Brisbane. Answer: { sent, text } (plus `note` when nothing was posted). A second call inside 5 days answers
 * { sent: false, text: null, note: "Already sent this week." } and posts nothing.
 *
 * GET /api/invoices/digest?mode=weekly: the same text as a preview. Posts nothing and records nothing.
 *
 * POST { documentIds } is the old per-run message and now answers "nothing sent". GET ?documentIds=a,b still previews that text.
 *
 * All of them need the shared secret in the `x-invoice-secret` header (the same one the scanner script uses); there is no
 * signed-in user.
 */
function denied(check: ReturnType<typeof checkSecret>): NextResponse | null {
  if (check === "ok") return null;
  if (check === "not_configured") return NextResponse.json({ error: "Invoice intake is not set up yet." }, { status: 503 });
  return NextResponse.json({ error: "Not allowed" }, { status: 401 });
}

const NO_STORE = { "cache-control": "no-store" };

function failed(e: unknown): NextResponse {
  if (e instanceof DigestConfigError) return NextResponse.json({ error: e.message }, { status: 503 });
  return NextResponse.json({ error: "Could not build the digest." }, { status: 500 });
}

async function run(ids: string[], dryRun: boolean): Promise<NextResponse> {
  try {
    const result = await notifyDocuments(getServiceClient(), ids, { dryRun });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (e) {
    return failed(e);
  }
}

async function runWeekly(dryRun: boolean): Promise<NextResponse> {
  try {
    const { sent, text, note } = await sendWeeklyReview(getServiceClient(), { dryRun });
    return NextResponse.json(note ? { sent, text, note } : { sent, text }, { headers: NO_STORE });
  } catch (e) {
    return failed(e);
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
  const parsed = (body ?? {}) as { mode?: unknown; documentIds?: unknown };
  if (parsed.mode === "weekly") return runWeekly(false);
  const ids = cleanIds(parsed.documentIds, 200);
  if (!ids || ids.length === 0) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  if (!PER_RUN_SLACK) return NextResponse.json({ sent: false, text: null, messages: [], alreadyAnnounced: 0, note: "Per-run Slack messages are switched off." }, { headers: NO_STORE });
  return run(ids, false);
}

export async function GET(request: Request) {
  const no = denied(checkSecret(request.headers.get("x-invoice-secret")));
  if (no) return no;
  const params = new URL(request.url).searchParams;
  if (params.get("mode") === "weekly") return runWeekly(true);
  const ids = cleanIds((params.get("documentIds") ?? "").split(",").filter(Boolean), 200);
  if (!ids || ids.length === 0) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  return run(ids, true);
}
