/**
 * The top of every record's History group: who created it, and who last changed it. Pure helpers plus one loader.
 *
 * Created line, in order of what is known:
 *  1. an insert row in cost_change_history for the record (earliest one, so a record put back from Trash still says who
 *     first made it):                       "Created by Brendan, Mon 5 Oct 1:38pm"
 *  2. no insert row (the record is older than the history, which began on 5 Oct 2026) but the table has created_at:
 *                                          "Created Wed 24 Sep 2026. Who created it was not recorded."
 *  3. neither:                             "Created before change history began. Who created it was not recorded."
 *  When the history could not be read at all (offline, table missing) the first line is not claimed: created_at alone gives
 *  "Created Wed 24 Sep 2026." and with no created_at there is no line.
 *
 * Last changed line: the newest event for the record or its child rows (the record's own insert, and the lines saved a
 * moment after it, are the creation, not a change), or the table's updated_by / updated_at stamp when that is newer
 * (dishes and preps carry the stamp). Null when nothing changed since creation.
 *
 * Names come from the caller's nameOf (lib/people.ts personName); a null changed_by is "Database", never blank.
 * All times are Brisbane time.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchChangeHistory, type HistoryRow } from "./change-history";
import { RESTORABLE } from "./trash";

type R = Record<string, unknown>;

/** Columns read from the record itself for the stamps. suppliers have no created_at, so they have none here. */
export const STAMP_COLUMNS: Record<string, string> = {
  cost_menu_items: "created_at,updated_at,updated_by",
  cost_preps: "created_at,updated_at,updated_by",
  cost_ingredients: "created_at,updated_at",
  cost_beers: "created_at,updated_at",
  cost_beer_serves: "created_at,updated_at",
  cost_gelato_serves: "created_at,updated_at",
  cost_offers: "created_at,updated_at",
  cost_ingredient_deals: "created_at,updated_at",
  cost_specials: "created_at",
};

export interface RecordStamps {
  created_at?: string | null;
  updated_at?: string | null;
  updated_by?: string | null;
}

/** The child tables whose rows belong to a record's history (the restore registry's children: lines, serve prices, ...). */
export function historyChildTables(table: string): string[] {
  return (RESTORABLE[table]?.children ?? []).map((c) => c.table);
}

/** What the footer calls the child rows ("The latest changes to this record and its ingredients"). */
const CHILD_WORDS: Record<string, string> = {
  cost_menu_items: "ingredients",
  cost_preps: "ingredients",
  cost_beers: "serve prices",
  cost_gelato_serves: "packaging",
  cost_offers: "components",
};
export const historyChildWord = (table: string): string | null => (historyChildTables(table).length ? CHILD_WORDS[table] ?? "lines" : null);

/** A child event this soon after the record's own insert is part of creating it, not a change. */
export const CREATION_WINDOW_MS = 2 * 60_000;

const TZ = "Australia/Brisbane";
const valid = (s: string | null | undefined): s is string => !!s && !Number.isNaN(new Date(s).getTime());
const ms = (s: string): number => new Date(s).getTime();

function parts(d: Date, o: Intl.DateTimeFormatOptions): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat("en-AU", { timeZone: TZ, ...o }).formatToParts(d).map((p) => [p.type, p.value]));
}

/** "Wed 24 Sep 2026" (the year is always there), Brisbane time. */
export function dateWithYear(at: string | Date): string {
  const p = parts(new Date(at), { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  return `${p.weekday} ${p.day} ${p.month.slice(0, 3)} ${p.year}`;
}

/** "Mon 5 Oct 1:38pm", Brisbane time. The year is added only when it is not this year. */
export function dateTimeLabel(at: string | Date, now: Date = new Date()): string {
  const p = parts(new Date(at), { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const year = parts(now, { year: "numeric" }).year;
  const t = parts(new Date(at), { hour: "numeric", minute: "2-digit", hour12: true });
  const time = `${t.hour}:${t.minute}${String(t.dayPeriod).toLowerCase().replace(/\./g, "")}`;
  return `${p.weekday} ${p.day} ${p.month.slice(0, 3)}${p.year !== year ? ` ${p.year}` : ""} ${time}`;
}

const newestFirst = (a: HistoryRow, b: HistoryRow): number => ms(b.changed_at) - ms(a.changed_at) || Number(b.id) - Number(a.id);

/** The earliest insert row for this record, or null. */
export function creationRow(rows: readonly HistoryRow[], table: string, key: string): HistoryRow | null {
  const inserts = rows.filter((r) => r.op === "insert" && r.table_name === table && r.row_key === key && valid(r.changed_at));
  if (!inserts.length) return null;
  return [...inserts].sort((a, b) => ms(a.changed_at) - ms(b.changed_at) || Number(a.id) - Number(b.id))[0];
}

export type NameOf = (email: string | null | undefined) => string | null;
const who = (email: string | null | undefined, nameOf: NameOf): string => {
  const e = (email ?? "").trim();
  if (!e) return "Database";
  return nameOf(e) || e;
};

export interface CreatedInput {
  rows: readonly HistoryRow[];
  table: string;
  key: string;
  stamps?: RecordStamps | null;
  nameOf: NameOf;
  /** false when the history could not be read (offline, table missing): then "who created it was not recorded" is not claimed */
  historyKnown?: boolean;
  now?: Date;
}

/** The first line of the History group, or null when nothing at all is known. */
export function createdLine(i: CreatedInput): string | null {
  const first = creationRow(i.rows, i.table, i.key);
  if (first) return `Created by ${who(first.changed_by, i.nameOf)}, ${dateTimeLabel(first.changed_at, i.now)}`;
  const at = i.stamps?.created_at;
  if (i.historyKnown === false) return valid(at) ? `Created ${dateWithYear(at)}.` : null;
  if (valid(at)) return `Created ${dateWithYear(at)}. Who created it was not recorded.`;
  return "Created before change history began. Who created it was not recorded.";
}

/** The second line ("Last changed by Brendan, Mon 5 Oct 1:38pm"), or null when nothing changed since creation. */
export function lastChangedLine(i: CreatedInput): string | null {
  const first = creationRow(i.rows, i.table, i.key);
  const belongs = (r: HistoryRow) => (r.table_name === i.table && r.row_key === i.key) || (r.parent_table === i.table && r.parent_id === i.key);
  const events = i.rows.filter((r) => belongs(r) && valid(r.changed_at) && r.id !== first?.id).filter((r) => {
    // the lines a new record is saved with a moment after it are part of creating it
    if (!first || r.op !== "insert" || (r.table_name === i.table && r.row_key === i.key)) return true;
    return ms(r.changed_at) - ms(first.changed_at) > CREATION_WINDOW_MS || ms(r.changed_at) < ms(first.changed_at);
  });
  const latest = [...events].sort(newestFirst)[0] ?? null;
  const s = i.stamps;
  const stampBy = (s?.updated_by ?? "").trim();
  const stampAt = valid(s?.updated_at) ? s!.updated_at! : null;
  const createdAt = first?.changed_at ?? (valid(s?.created_at) ? s!.created_at! : null);
  // a stamp counts when someone is named and it is newer than the newest event; a stamp made while creating is not a change
  const stampIsChange = !!stampBy && (stampAt ? !createdAt || ms(stampAt) - ms(createdAt) > CREATION_WINDOW_MS : true);
  const stampNewer = stampIsChange && (!latest || (stampAt ? ms(stampAt) > ms(latest.changed_at) + 60_000 : false));
  if (latest && !stampNewer) return `Last changed by ${who(latest.changed_by, i.nameOf)}, ${dateTimeLabel(latest.changed_at, i.now)}`;
  if (stampNewer) return `Last changed by ${who(stampBy, i.nameOf)}${stampAt ? `, ${dateTimeLabel(stampAt, i.now)}` : ""}`;
  return null;
}

export interface StatusLines {
  created: string | null;
  lastChanged: string | null;
}
export function recordStatusLines(i: CreatedInput): StatusLines {
  return { created: createdLine(i), lastChanged: lastChangedLine(i) };
}

/* ------------------------------------------------------------------ loading */

/** How many rows of each kind (the record's own, its children's) are fetched; the group shows 10 and Show More the rest. */
export const HISTORY_LOAD = 60;
/** Insert rows read to find the earliest (a record put back from Trash has more than one). */
const INSERT_LOAD = 50;

export interface LoadedHistory {
  /** the record's own rows plus its children's, newest first, no duplicates (includes the insert rows read separately) */
  rows: HistoryRow[];
  stamps: RecordStamps | null;
  /** false when the history table could not be read */
  historyKnown: boolean;
}

/**
 * Everything the group needs, in parallel. Never throws: a failure or a missing table is "no history" (historyKnown false
 * when the reads themselves failed), and the stamps read is best effort.
 */
export async function loadRecordHistory(sb: SupabaseClient, table: string, key: string): Promise<LoadedHistory> {
  const hasChildren = historyChildTables(table).length > 0;
  const cols = STAMP_COLUMNS[table];
  const readStamps = async (): Promise<RecordStamps | null> => {
    if (!cols) return null;
    try {
      const res = (await sb.from(table).select(cols).eq("id", key).limit(1)) as { data: unknown; error: unknown };
      return res.error ? null : (((res.data as R[] | null) ?? [])[0] as RecordStamps | undefined) ?? null;
    } catch {
      return null;
    }
  };
  const stampsP = readStamps();
  const [own, kids, inserts, stamps] = await Promise.all([
    fetchChangeHistory(sb, { table, rowKey: key, limit: HISTORY_LOAD }),
    hasChildren ? fetchChangeHistory(sb, { parentTable: table, parentId: key, limit: HISTORY_LOAD }) : Promise.resolve(null),
    fetchChangeHistory(sb, { table, rowKey: key, op: "insert", limit: INSERT_LOAD }),
    stampsP,
  ]);
  const seen = new Set<string>();
  const rows = [...own.rows, ...(kids?.rows ?? []), ...inserts.rows].filter((r) => (seen.has(String(r.id)) ? false : (seen.add(String(r.id)), true)));
  rows.sort(newestFirst);
  const historyKnown = !(own.missing || own.error || inserts.missing || inserts.error);
  return { rows, stamps, historyKnown };
}
