/**
 * Browser side of Research This Drink: asks /api/research-drink for notes and checks the answer again before anything is
 * filed. Failures come back as { ok: false, reason, message } with plain words; nothing here throws.
 */
import { prepareNotes, researchWhy, type DrinkRequest, type ResearchedNote } from "./research-drink";
import { LINE_UNITS, type LineUnit } from "./types";

export type ResearchAnswer = { ok: true; notes: ResearchedNote[]; searches: number } | { ok: false; reason: string; message: string };

const fail = (reason: string): ResearchAnswer => ({ ok: false, reason, message: researchWhy(reason) });

/** The server's own checks already ran; this only makes sure the shape is what the database takes. */
function cleanNote(n: unknown): ResearchedNote | null {
  if (!n || typeof n !== "object") return null;
  const o = n as Partial<ResearchedNote>;
  if ((o.kind !== "difference" && o.kind !== "suggestion") || typeof o.title !== "string" || !o.title.trim() || typeof o.body !== "string") return null;
  const sources = Array.isArray(o.sources) ? o.sources.filter((s) => s && typeof s.label === "string" && typeof s.url === "string" && /^https?:\/\//i.test(s.url)) : [];
  if (!sources.length) return null;
  const changes = Array.isArray(o.changes) ? o.changes.filter((c) => c && typeof c.ingredient_id === "string" && Number.isFinite(c.qty) && c.qty !== 0 && LINE_UNITS.includes(c.unit as LineUnit)) : [];
  return {
    kind: o.kind,
    title: o.title.trim(),
    body: o.body.trim(),
    changes,
    method_step: typeof o.method_step === "string" && o.method_step.trim() ? o.method_step.trim() : null,
    method_replaces: typeof o.method_replaces === "string" && o.method_replaces.trim() ? o.method_replaces.trim() : null,
    sources,
  };
}

/** Sends the drink for research. `signal` is the Cancel button; the browser also gives up after 58 seconds. */
export async function requestResearch(input: DrinkRequest, signal?: AbortSignal, fetchImpl: typeof fetch = fetch, timeoutMs = 58000): Promise<ResearchAnswer> {
  const joined = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    joined.abort();
  }, timeoutMs);
  const stop = () => joined.abort();
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) joined.abort();
  try {
    const res = await fetchImpl("/api/research-drink", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), signal: joined.signal });
    if (res.status === 401) return fail("not_signed_in");
    if (res.status === 400) return fail("bad_request");
    if (res.status === 504) return fail("timeout");
    const body = (await res.json().catch(() => null)) as { notes?: unknown; searches?: unknown; reason?: unknown } | null;
    if (!res.ok || !body) return fail(typeof body?.reason === "string" ? body.reason.slice(0, 40) : `http_${res.status}`);
    const raw = Array.isArray(body.notes) ? body.notes : null;
    if (!raw) return fail("bad_reply_notes");
    const notes = prepareNotes(raw.map(cleanNote).filter((n): n is ResearchedNote => !!n), input.existingTitles);
    return { ok: true, notes, searches: typeof body.searches === "number" ? body.searches : 0 };
  } catch {
    // Cancel is reported as "cancelled" (the caller knows it cancelled); anything else is the browser giving up or being offline
    return fail(timedOut ? "timeout" : signal?.aborted ? "cancelled" : "unreachable");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}
