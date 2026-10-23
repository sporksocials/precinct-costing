import { NextResponse } from "next/server";
import {
  appOrigin,
  checkSecret,
  cleanIds,
  DigestConfigError,
  getServiceClient,
  loadWeeklyPlan,
  markQuestionsEmailed,
  signAttachments,
} from "@/lib/invoice-digest-data";
import { buildWeeklyEmail } from "@/lib/invoice-digest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/invoices/weekly: the Monday email of open questions, ready for the scanner script to send.
 * Answer: { subject, text, html, attachments: [{ name, url }], questionIds, skipped }. `skipped` is true (and nothing is
 * built) when no question is due. Attachment links are signed for 10 minutes and the script downloads them straight away.
 *
 * POST /api/invoices/weekly { questionIds }: the script calls this AFTER the email went out, to mark those questions as
 * emailed (so they are not repeated for 7 days) and to record the send in invoice_digests.
 *
 * Both need the shared secret in the `x-invoice-secret` header; there is no signed-in user.
 */
function denied(check: ReturnType<typeof checkSecret>): NextResponse | null {
  if (check === "ok") return null;
  if (check === "not_configured") return NextResponse.json({ error: "Invoice intake is not set up yet." }, { status: 503 });
  return NextResponse.json({ error: "Not allowed" }, { status: 401 });
}

export async function GET(request: Request) {
  const no = denied(checkSecret(request.headers.get("x-invoice-secret")));
  if (no) return no;
  try {
    const sb = getServiceClient();
    const now = new Date();
    const first = await loadWeeklyPlan(sb, now);
    if (first.questionIds.length === 0) {
      return NextResponse.json({ subject: "", text: "", html: "", attachments: [], questionIds: [], skipped: true }, { headers: { "cache-control": "no-store" } });
    }
    const { plan, attachments } = await signAttachments(sb, first);
    const email = buildWeeklyEmail(plan, { origin: appOrigin(), now });
    return NextResponse.json({ subject: email.subject, text: email.text, html: email.html, attachments, questionIds: email.questionIds, skipped: false }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof DigestConfigError) return NextResponse.json({ error: e.message }, { status: 503 });
    return NextResponse.json({ error: "Could not build the weekly email." }, { status: 500 });
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
  const ids = cleanIds((body as { questionIds?: unknown } | null)?.questionIds, 500);
  if (!ids || ids.length === 0) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  try {
    const result = await markQuestionsEmailed(getServiceClient(), ids);
    return NextResponse.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof DigestConfigError) return NextResponse.json({ error: e.message }, { status: 503 });
    return NextResponse.json({ error: "Could not mark the questions as emailed." }, { status: 500 });
  }
}
