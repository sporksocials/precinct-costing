/**
 * Invoice intake authentication. The scanner script (Google Apps Script) has no signed-in user, so its two routes
 * (/api/invoices/upload-url and /api/invoices/process) are open to the middleware and check the shared secret instead.
 *
 * Edge safe on purpose (the middleware imports isInvoiceIngestPath): no Node imports here, and the comparison below does
 * the work by hand so it takes the same time wherever the first difference is.
 */
import { INVOICE_ENV } from "./invoice-types";

export const INVOICE_SECRET_HEADER = "x-invoice-secret";

/** Exactly the two scanner routes. Other /api/invoices/... routes (answers, undo) belong to signed-in people and stay behind the login. */
export const INVOICE_INGEST_PATHS = ["/api/invoices/upload-url", "/api/invoices/process", "/api/invoices/digest", "/api/invoices/weekly"];

export function isInvoiceIngestPath(pathname: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return INVOICE_INGEST_PATHS.includes(p);
}

/** Constant-time string equality: pads to the longer length and folds the length difference into the result. */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  const n = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export type SecretCheck = "ok" | "denied" | "not_configured";

/** Checks the header value against INVOICE_INGEST_SECRET. A missing server secret never lets anyone in. */
export function checkInvoiceSecret(headerValue: string | null | undefined, env: Record<string, string | undefined> = process.env): SecretCheck {
  const expected = env[INVOICE_ENV.ingestSecret]?.trim();
  if (!expected) return "not_configured";
  if (typeof headerValue !== "string" || headerValue.length === 0) return "denied";
  return safeEqual(headerValue.trim(), expected) ? "ok" : "denied";
}
