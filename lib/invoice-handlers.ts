/**
 * The two scanner routes as plain functions (Request in, Response out) so the tests can call them with fakes. The route files
 * (app/api/invoices/upload-url and process) are one line each. Both authenticate with the shared secret in `x-invoice-secret`,
 * NOT a user session: the scanner script has no signed-in user. Errors are short and neutral; env values and stack traces are
 * never put in a response.
 */
import { INVOICE_SECRET_HEADER, checkInvoiceSecret } from "./invoice-auth";
import { AWAITING_UPLOAD, brisbaneToday, processStep, type PipelineDeps } from "./invoice-pipeline";
import type { IngestStore } from "./invoice-repo";

type Env = Record<string, string | undefined>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

/** Null when the caller may carry on, else the response to send. A missing server secret never lets anyone in. */
function denied(request: Request, env: Env): Response | null {
  const check = checkInvoiceSecret(request.headers.get(INVOICE_SECRET_HEADER), env);
  if (check === "ok") return null;
  if (check === "not_configured") return json({ error: "Invoice intake is not set up yet." }, 503);
  return json({ error: "Not allowed." }, 401);
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = (await request.json()) as unknown;
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;

export interface UploadDeps {
  getStore: () => IngestStore;
  env?: Env;
  /** Brisbane today, yyyy-mm-dd (tests inject it) */
  today?: () => string;
}

function logFailure(what: string, e: unknown) {
  // the message only: no stack, no request, no env values
  console.error(`[invoices] ${what}: ${e instanceof Error ? e.message.slice(0, 200) : "unknown error"}`);
}

/**
 * POST /api/invoices/upload-url
 *   { venue, fileName, sha256, driveFileId?, pageCountHint? } -> { fileId, duplicate: true }
 *                                                              or { fileId, path, uploadUrl, token }  (PUT the PDF to uploadUrl)
 *   { fileId, uploaded: true }                                 -> { fileId, ready: true }
 * The file row is created at the first call but marked "awaiting upload" (attempts = AWAITING_UPLOAD) so the reader cannot claim a
 * PDF that has not arrived; the second call checks the PDF is in the bucket and releases it. A repeat of the first call for a file
 * that never finished uploading gets a fresh upload link, not a "duplicate".
 */
export async function handleUploadUrl(request: Request, deps: UploadDeps): Promise<Response> {
  const env = deps.env ?? (process.env as Env);
  const no = denied(request, env);
  if (no) return no;
  const body = await readBody(request);
  if (!body) return json({ error: "Bad request." }, 400);

  try {
    const store = deps.getStore();

    if (body.uploaded === true) {
      const fileId = body.fileId;
      if (typeof fileId !== "string" || !UUID.test(fileId)) return json({ error: "Bad request." }, 400);
      const file = await store.getFile(fileId);
      if (!file) return json({ error: "File not found." }, 404);
      if (file.attempts !== AWAITING_UPLOAD) return json({ fileId, ready: true });
      if (!(await store.objectExists(file.storage_path))) return json({ error: "The PDF has not arrived yet." }, 409);
      await store.setAttempts(fileId, 0);
      return json({ fileId, ready: true });
    }

    const venue = body.venue;
    const sha = body.sha256;
    const fileName = body.fileName;
    if (typeof venue !== "string" || !SLUG.test(venue)) return json({ error: "Bad request." }, 400);
    if (typeof sha !== "string" || !SHA256.test(sha)) return json({ error: "Bad request." }, 400);
    if (typeof fileName !== "string" || fileName.trim() === "" || fileName.length > 200) return json({ error: "Bad request." }, 400);
    const drive = body.driveFileId;
    if (drive != null && (typeof drive !== "string" || drive.length > 200)) return json({ error: "Bad request." }, 400);
    const hint = body.pageCountHint;
    if (hint != null && (typeof hint !== "number" || !Number.isInteger(hint) || hint < 1 || hint > 1000)) return json({ error: "Bad request." }, 400);

    const venueId = await store.venueIdForSlug(venue);
    if (venueId == null) return json({ error: "Unknown venue." }, 400);
    const hash = sha.toLowerCase();

    let file = await store.findFile(venueId, hash);
    if (file && file.attempts !== AWAITING_UPLOAD) return json({ fileId: file.id, duplicate: true });
    if (!file) {
      const day = (deps.today ?? (() => brisbaneToday(Date.now())))();
      const path = `incoming/${venue}/${day}/${hash}.pdf`;
      try {
        file = await store.createFile({ venue_id: venueId, source_name: fileName.trim(), drive_file_id: typeof drive === "string" && drive ? drive : null, storage_path: path, sha256: hash, page_count: typeof hint === "number" ? hint : null, attempts: AWAITING_UPLOAD });
      } catch (e) {
        // two uploads of the same scan at once: the other one won, so use its row
        file = await store.findFile(venueId, hash);
        if (!file) throw e;
        if (file.attempts !== AWAITING_UPLOAD) return json({ fileId: file.id, duplicate: true });
      }
    }
    const link = await store.signedUploadUrl(file.storage_path);
    if (!link) return json({ error: "Could not make an upload link." }, 500);
    return json({ fileId: file.id, path: file.storage_path, uploadUrl: link.uploadUrl, token: link.token });
  } catch (e) {
    logFailure("upload-url", e);
    return json({ error: "Could not prepare that upload." }, 500);
  }
}

export interface ProcessDeps {
  getDeps: () => Promise<PipelineDeps> | PipelineDeps;
  env?: Env;
}

/** POST /api/invoices/process: runs one bounded step and returns its result (the script calls again until idle is true). */
export async function handleProcess(request: Request, deps: ProcessDeps): Promise<Response> {
  const env = deps.env ?? (process.env as Env);
  const no = denied(request, env);
  if (no) return no;
  let pipeline: PipelineDeps;
  try {
    pipeline = await deps.getDeps();
  } catch (e) {
    logFailure("process setup", e);
    return json({ error: "The invoice reader is not set up yet." }, 503);
  }
  try {
    return json(await processStep(pipeline));
  } catch (e) {
    logFailure("process", e);
    return json({ error: "Could not process that step." }, 500);
  }
}
