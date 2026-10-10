import type { MatrixRow } from "./allergy-matrix";
import { MATRIX_COLUMNS } from "./allergy-matrix";
import { printedDate } from "./allergy-matrix-print";
import { groupLabel } from "./kitchen";

/**
 * The Allergy Matrix print log (Troy, 10 Oct 2026; table `cost_matrix_prints`, migration 20261010150000). Pure rules, no React, no database.
 *
 * Every print of a venue section (or of All Sections, key `*`) is one row: a version number (the previous highest for that venue and
 * key, plus one), who and when, and a SNAPSHOT: a map of dish id to a short stable hash of the dish's printed row (its name, section,
 * every cell's state and note, and whether its sign-off was valid). Comparing the snapshot with the matrix as it is now says which
 * dishes were added, removed or changed since the last print, without storing the answers themselves. A key that was never printed
 * reads "Not printed yet" and is never an alert.
 */

/** The key of an All Sections print. */
export const ALL_SECTIONS = "*";

/** One printed section (or All Sections) as the database holds it. */
export interface MatrixPrint {
  id: string;
  venue_id: number;
  section: string;
  version: number;
  printed_at: string;
  printed_by: string | null;
  snapshot: Record<string, string>;
}

/** The key for a section name: `*` for All Sections (or nothing), otherwise the label with "Other" for a dish with no section. */
export function printKey(section: string | null | undefined): string {
  const s = (section ?? "").trim();
  return !s || s === ALL_SECTIONS ? ALL_SECTIONS : s;
}

/** 53-bit string hash (cyrb53), written in base 36. Stable across runs and devices; not a security hash. */
export function shortHash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** What a dish's printed row says, as one canonical string: name, section, whether its sign-off is valid, and every cell's state and note. */
export function dishRowText(row: MatrixRow): string {
  const cells = MATRIX_COLUMNS.map((c) => {
    const cell = row.cells[c.id];
    return `${cell.state}${cell.note ? `:${cell.note}` : ""}`;
  });
  return [row.dish.name, groupLabel(row.dish.section), row.confirmed ? "valid" : "not valid", ...cells].join("\u001f");
}

export function dishRowHash(row: MatrixRow): string {
  return shortHash(dishRowText(row));
}

/** The rows a key covers: every row for `*`, otherwise the rows of that section. */
export function rowsForKey(rows: readonly MatrixRow[], key: string): MatrixRow[] {
  return key === ALL_SECTIONS ? [...rows] : rows.filter((r) => groupLabel(r.dish.section) === key);
}

/** { dish id: hash } for the rows on a sheet. */
export function buildSnapshot(rows: readonly MatrixRow[]): Record<string, string> {
  return Object.fromEntries(rows.map((r) => [r.dish.id, dishRowHash(r)]));
}

export interface SnapshotDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

/** Dish ids added to, removed from and changed on the sheet since `prev` was printed. */
export function diffSnapshot(prev: Record<string, string>, now: Record<string, string>): SnapshotDiff {
  const added = Object.keys(now).filter((id) => !(id in prev));
  const removed = Object.keys(prev).filter((id) => !(id in now));
  const changed = Object.keys(now).filter((id) => id in prev && prev[id] !== now[id]);
  return { added, removed, changed };
}

export const diffIsEmpty = (d: SnapshotDiff): boolean => !d.added.length && !d.removed.length && !d.changed.length;

/** "2 added, 1 removed, 3 changed" (parts that are zero are left out). */
export function diffSummary(d: SnapshotDiff): string {
  return [d.added.length ? `${d.added.length} added` : "", d.removed.length ? `${d.removed.length} removed` : "", d.changed.length ? `${d.changed.length} changed` : ""].filter(Boolean).join(", ");
}

/** The highest-version print for a venue and key, or null when it was never printed. */
export function lastPrint(prints: readonly MatrixPrint[] | null | undefined, venueId: number, key: string): MatrixPrint | null {
  let best: MatrixPrint | null = null;
  for (const p of prints ?? []) if (p.venue_id === venueId && p.section === key && (!best || p.version > best.version)) best = p;
  return best;
}

/** The version a print made now gets: the previous highest for that venue and key, plus one. */
export function nextVersion(prints: readonly MatrixPrint[] | null | undefined, venueId: number, key: string): number {
  return (lastPrint(prints, venueId, key)?.version ?? 0) + 1;
}

/** The row to insert when a print is made. `version` comes from `nextVersion`. */
export function printRow(args: { venueId: number; key: string; version: number; by: string | null; rows: readonly MatrixRow[] }): Omit<MatrixPrint, "id" | "printed_at"> {
  return { venue_id: args.venueId, section: args.key, version: args.version, printed_by: args.by, snapshot: buildSnapshot(rowsForKey(args.rows, args.key)) };
}

export type PrintStatus =
  | { state: "never" }
  | { state: "current"; version: number; printedAt: string; line: string }
  | { state: "changed"; version: number; printedAt: string; line: string; diff: SnapshotDiff; summary: string; added: string[]; removed: string[]; changed: string[] };

/** "Last printed 10 Oct 2026, version 3". */
export function lastPrintedLine(p: Pick<MatrixPrint, "printed_at" | "version">): string {
  return `Last printed ${printedDate(new Date(p.printed_at))}, version ${p.version}`;
}

/**
 * Where a venue's sheet stands against its last print. `rows` is the venue's whole matrix; the key picks the sheet. `nameOf` names a
 * dish that is no longer on the matrix (removed or switched off). A key never printed is `never`, which is not an alert.
 */
export function printStatus(prints: readonly MatrixPrint[] | null | undefined, venueId: number, key: string, rows: readonly MatrixRow[], nameOf: (dishId: string) => string | null = () => null): PrintStatus {
  const last = lastPrint(prints, venueId, key);
  if (!last) return { state: "never" };
  const here = rowsForKey(rows, key);
  const diff = diffSnapshot(last.snapshot ?? {}, buildSnapshot(here));
  const line = lastPrintedLine(last);
  if (diffIsEmpty(diff)) return { state: "current", version: last.version, printedAt: last.printed_at, line };
  const names = new Map(here.map((r) => [r.dish.id, r.dish.name]));
  const nm = (id: string) => names.get(id) ?? nameOf(id) ?? "A dish that is no longer on the menu";
  const sortNames = (ids: string[]) => ids.map(nm).sort((a, b) => a.localeCompare(b, "en-AU", { sensitivity: "base" }));
  return {
    state: "changed",
    version: last.version,
    printedAt: last.printed_at,
    line,
    diff,
    summary: `Changed since printed: ${diffSummary(diff)}`,
    added: sortNames(diff.added),
    removed: sortNames(diff.removed),
    changed: sortNames(diff.changed),
  };
}

/** Every key a venue has ever been printed under, so the alerts and the To Do hub can look at each sheet. */
export function printedKeys(prints: readonly MatrixPrint[] | null | undefined, venueId: number): string[] {
  return [...new Set((prints ?? []).filter((p) => p.venue_id === venueId).map((p) => p.section))].sort((a, b) => (a === ALL_SECTIONS ? -1 : b === ALL_SECTIONS ? 1 : a.localeCompare(b, "en-AU", { sensitivity: "base" })));
}

export interface ChangedSheet {
  venueId: number;
  key: string;
  status: Extract<PrintStatus, { state: "changed" }>;
}

/** The sheets of a venue that changed since their last print (never-printed sheets are not included). */
export function changedSheets(prints: readonly MatrixPrint[] | null | undefined, venueId: number, rows: readonly MatrixRow[], nameOf?: (dishId: string) => string | null): ChangedSheet[] {
  const out: ChangedSheet[] = [];
  for (const key of printedKeys(prints, venueId)) {
    const s = printStatus(prints, venueId, key, rows, nameOf);
    if (s.state === "changed") out.push({ venueId, key, status: s });
  }
  return out;
}

/** Keeps the highest version per venue and key, newest first by version: the only prints the screens need. */
export function latestPrints(all: readonly MatrixPrint[]): MatrixPrint[] {
  const best = new Map<string, MatrixPrint>();
  for (const p of all) {
    const k = `${p.venue_id}\u001f${p.section}`;
    const cur = best.get(k);
    if (!cur || p.version > cur.version) best.set(k, p);
  }
  return [...best.values()];
}

/** A tolerant read of a database row (a malformed snapshot reads as empty, so it shows everything as changed rather than crashing). */
export function readPrint(raw: unknown): MatrixPrint | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const venue = Number(r.venue_id);
  const version = Number(r.version);
  if (!Number.isFinite(venue) || !Number.isFinite(version) || typeof r.section !== "string" || typeof r.printed_at !== "string") return null;
  const snap: Record<string, string> = {};
  if (r.snapshot && typeof r.snapshot === "object" && !Array.isArray(r.snapshot)) for (const [k, v] of Object.entries(r.snapshot as Record<string, unknown>)) if (typeof v === "string") snap[k] = v;
  return { id: String(r.id ?? ""), venue_id: venue, section: r.section, version, printed_at: r.printed_at, printed_by: typeof r.printed_by === "string" ? r.printed_by : null, snapshot: snap };
}
