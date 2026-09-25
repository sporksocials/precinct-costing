/**
 * Change Log: pure normalisation of the three change sources into one list of plain-English events.
 * Sources (all read only, written by database triggers):
 *   cost_audit_log       targets, settings, who can sign in, target overrides, ingredient details
 *   cost_sell_price_log  menu, beer and gelato sell price changes
 *   cost_price_log       ingredient pack price changes
 * Nothing here writes anything, and unknown tables or columns fall back to readable text instead of throwing.
 */

export type ChangeKind = "target" | "setting" | "access" | "sell_price" | "ingredient_price" | "ingredient_detail" | "override";
export type Direction = "up" | "down" | "none";
/** good = green, bad = red, none = neutral (a cost going up is bad, a sell price or target going up is good) */
export type Tone = "good" | "bad" | "none";

export interface ChangeEvent {
  id: string;
  /** ISO timestamp */
  at: string;
  /** email, or null when the database did not record who */
  who: string | null;
  kind: ChangeKind;
  title: string;
  detail: string;
  oldValue: string;
  newValue: string;
  venueId?: number;
  refHref?: string;
  direction: Direction;
  tone: Tone;
}

export interface AuditRow {
  id: number | string;
  table_name?: string | null;
  row_key?: string | null;
  op?: string | null;
  column_name?: string | null;
  old_value?: string | null;
  new_value?: string | null;
  changed_by?: string | null;
  changed_at?: string | null;
}
export interface SellPriceRow {
  id: number | string;
  kind?: string | null;
  item_id?: string | null;
  beer_id?: string | null;
  serve_id?: string | null;
  venue_id?: number | null;
  old_price?: number | string | null;
  new_price?: number | string | null;
  old_hh_price?: number | string | null;
  new_hh_price?: number | string | null;
  changed_by?: string | null;
  changed_at?: string | null;
}
export interface PriceLogRow {
  id: number | string;
  ingredient_id?: string | null;
  changed_at?: string | null;
  old_price?: number | string | null;
  new_price?: number | string | null;
  source?: string | null;
  entered_by?: string | null;
  notes?: string | null;
}

/** Names the page resolves from the loaded store. Any lookup may return undefined (deleted or not loaded). */
export interface Lookups {
  venueName: (id: number) => string | undefined;
  itemName: (id: string) => { name: string; venueId?: number } | undefined;
  beerName: (id: string) => { name: string; venueId?: number } | undefined;
  beerServeName: (id: string) => string | undefined;
  gelatoServeName: (id: string) => { name: string; venueId?: number } | undefined;
  ingredientName: (id: string) => string | undefined;
}
export const NO_LOOKUPS: Lookups = {
  venueName: () => undefined,
  itemName: () => undefined,
  beerName: () => undefined,
  beerServeName: () => undefined,
  gelatoServeName: () => undefined,
  ingredientName: () => undefined,
};

/* ------------------------------------------------------------------ formatting */

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** 0.72 -> "72%", 0.725 -> "72.5%". */
export function fmtPercent(v: unknown): string {
  const n = num(v);
  if (n == null) return textOr(v);
  return `${Math.round(n * 1000) / 10}%`;
}
/** 4.5 -> "$4.50". */
export function fmtMoney(v: unknown): string {
  const n = num(v);
  if (n == null) return textOr(v);
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
}
const textOr = (v: unknown): string => (v == null || v === "" ? "None" : String(v));

/** Turns "pack_size" into "Pack size". */
export function humanise(s: string): string {
  const t = s.replace(/^cost_/, "").replace(/[_-]+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Unknown";
}

const SETTING_LABELS: Record<string, { label: string; fmt: (v: unknown) => string }> = {
  gst_rate: { label: "GST rate", fmt: fmtPercent },
  round_to: { label: "Round prices up to", fmt: fmtMoney },
  alert_pct: { label: "Price alert level", fmt: fmtPercent },
  gelato_wastage: { label: "Gelato wastage", fmt: fmtPercent },
};

/** Ingredient columns that may appear once ingredient attribute changes are audited. */
const INGREDIENT_COLUMNS: Record<string, { label: string; fmt?: (v: unknown) => string }> = {
  name: { label: "Name" },
  category: { label: "Category" },
  supplier_id: { label: "Supplier" },
  supplier_code: { label: "Supplier code" },
  pack_size: { label: "Pack size" },
  pack_unit: { label: "Pack unit" },
  pack_price: { label: "Pack price", fmt: fmtMoney },
  price_inc_gst: { label: "Price includes GST", fmt: yesNo },
  gst_free: { label: "GST free", fmt: yesNo },
  rebate: { label: "Rebate", fmt: fmtPercent },
  yield_pct: { label: "Yield", fmt: fmtPercent },
  venues: { label: "Venues" },
  active: { label: "Active", fmt: yesNo },
  notes: { label: "Notes" },
};

function yesNo(v: unknown): string {
  if (v === true || v === "true" || v === "t") return "Yes";
  if (v === false || v === "false" || v === "f") return "No";
  return textOr(v);
}

/** Generic value formatter for unknown columns: percent-looking names get percents, price-looking names get dollars. */
function guessFmt(column: string): (v: unknown) => string {
  if (/(_pct|_gp|target|rate|wastage)/.test(column)) return fmtPercent;
  if (/price/.test(column)) return fmtMoney;
  if (/^(active|on_menu|is_|has_)/.test(column)) return yesNo;
  return textOr;
}

function dirOf(a: unknown, b: unknown): Direction {
  const x = num(a);
  const y = num(b);
  if (x == null || y == null || x === y) return "none";
  return y > x ? "up" : "down";
}
const toneOf = (d: Direction, upIsGood: boolean): Tone => (d === "none" ? "none" : (d === "up") === upIsGood ? "good" : "bad");

function jsonField(text: string | null | undefined, field: string): unknown {
  if (!text) return undefined;
  try {
    const o = JSON.parse(text) as Record<string, unknown>;
    return o && typeof o === "object" ? o[field] : undefined;
  } catch {
    return undefined;
  }
}

const iso = (s: string | null | undefined): string => (s && !Number.isNaN(new Date(s).getTime()) ? new Date(s).toISOString() : new Date(0).toISOString());
const who = (s: string | null | undefined): string | null => (s && s.trim() ? s.trim() : null);

/* ------------------------------------------------------------------ audit log */

export function auditEvent(r: AuditRow, lk: Lookups = NO_LOOKUPS): ChangeEvent {
  const base = { id: `audit:${r.id}`, at: iso(r.changed_at), who: who(r.changed_by) };
  const table = String(r.table_name ?? "").replace(/^cost_/, "");
  const key = String(r.row_key ?? "");
  const col = r.column_name ?? "";
  const op = r.op ?? "update";
  const oldRaw = r.old_value ?? null;
  const newRaw = r.new_value ?? null;
  const dash = "None";

  try {
    if (table === "targets") {
      const [vid, ...rest] = key.split("/");
      const venueId = num(vid) ?? undefined;
      const venue = venueId != null ? lk.venueName(venueId) : undefined;
      const category = rest.join("/") || "All";
      const label = `${venue ?? "Venue"} ${category} target`;
      const o = op === "update" ? oldRaw : jsonField(oldRaw, "target_gp");
      const n = op === "update" ? newRaw : jsonField(newRaw, "target_gp");
      const d = dirOf(o, n);
      const verb = op === "insert" ? "Target set" : op === "delete" ? "Target removed" : "Target changed";
      return { ...base, kind: "target", title: op === "update" ? label : `${verb}: ${label}`, detail: targetDetail(o, n, d), oldValue: o == null ? dash : fmtPercent(o), newValue: n == null ? dash : fmtPercent(n), venueId, refHref: "/settings", direction: d, tone: toneOf(d, true) };
    }

    if (table === "settings") {
      const meta = SETTING_LABELS[key] ?? { label: humanise(key), fmt: guessFmt(key) };
      const o = op === "update" ? oldRaw : jsonField(oldRaw, "value");
      const n = op === "update" ? newRaw : jsonField(newRaw, "value");
      const d = dirOf(o, n);
      return { ...base, kind: "setting", title: op === "insert" ? `Setting added: ${meta.label}` : op === "delete" ? `Setting removed: ${meta.label}` : meta.label, detail: op === "update" ? "Setting changed" : op === "insert" ? "Setting added" : "Setting removed", oldValue: o == null ? dash : meta.fmt(o), newValue: n == null ? dash : meta.fmt(n), refHref: "/settings", direction: d, tone: "none" };
    }

    if (table === "allowed_users") {
      const email = key || String(jsonField(newRaw, "email") ?? jsonField(oldRaw, "email") ?? "") || "unknown";
      if (op === "insert") return { ...base, kind: "access", title: `Access added: ${email}`, detail: "Can now sign in", oldValue: dash, newValue: email, refHref: "/settings", direction: "none", tone: "good" };
      if (op === "delete") return { ...base, kind: "access", title: `Access removed: ${email}`, detail: "Can no longer sign in", oldValue: email, newValue: dash, refHref: "/settings", direction: "none", tone: "bad" };
      return { ...base, kind: "access", title: `Access changed: ${email}`, detail: humanise(col || "Access"), oldValue: textOr(oldRaw), newValue: textOr(newRaw), refHref: "/settings", direction: "none", tone: "none" };
    }

    if (table === "menu_items" || table === "beers" || table === "gelato_serves") {
      const rec = table === "menu_items" ? lk.itemName(key) : table === "beers" ? lk.beerName(key) : lk.gelatoServeName(key);
      const name = rec?.name ?? (table === "menu_items" ? "A menu item" : table === "beers" ? "A tap beer" : "A gelato serve");
      const refHref = table === "menu_items" && rec ? `/items/${key}` : table === "beers" && rec ? `/beers/${key}` : table === "gelato_serves" && rec ? "/gelato/serves" : undefined;
      const isTarget = col === "target_override" || col === "target_gp";
      const fmt = isTarget ? fmtPercent : guessFmt(col);
      const d = isTarget ? dirOf(oldRaw, newRaw) : "none";
      const title = isTarget ? `${name} own target` : `${name}: ${humanise(col || "record")}`;
      return { ...base, kind: "override", title, detail: isTarget ? (oldRaw == null ? "Own target set (was using the venue target)" : newRaw == null ? "Own target cleared (uses the venue target)" : targetDetail(oldRaw, newRaw, d)) : "Changed", oldValue: oldRaw == null ? dash : fmt(oldRaw), newValue: newRaw == null ? dash : fmt(newRaw), venueId: rec?.venueId, refHref, direction: d, tone: toneOf(d, true) };
    }

    if (table === "ingredients") {
      const name = lk.ingredientName(key) ?? "An ingredient";
      const meta = INGREDIENT_COLUMNS[col];
      const fmt = meta?.fmt ?? guessFmt(col);
      const label = meta?.label ?? humanise(col || "record");
      const d = dirOf(oldRaw, newRaw);
      const isPrice = col === "pack_price";
      return { ...base, kind: "ingredient_detail", title: op === "update" ? `${name}: ${label}` : `${name}: ${op === "insert" ? "added" : "removed"}`, detail: "Ingredient detail changed", oldValue: oldRaw == null ? dash : fmt(oldRaw), newValue: newRaw == null ? dash : fmt(newRaw), refHref: lk.ingredientName(key) ? `/ingredients/${key}` : undefined, direction: d, tone: isPrice ? toneOf(d, false) : "none" };
    }
  } catch {
    /* fall through to the generic text below */
  }

  // unknown table or unreadable row: say what we know in plain words
  const what = table ? humanise(table) : "Record";
  const verb = op === "insert" ? "added" : op === "delete" ? "removed" : "changed";
  return { ...base, kind: "ingredient_detail", title: col ? `${what}: ${humanise(col)} ${verb}` : `${what} ${verb}`, detail: key ? `Record ${key}` : "", oldValue: oldRaw == null ? dash : clip(oldRaw), newValue: newRaw == null ? dash : clip(newRaw), direction: "none", tone: "none" };
}

const clip = (s: string): string => (s.length > 60 ? `${s.slice(0, 57)}...` : s);

function targetDetail(o: unknown, n: unknown, d: Direction): string {
  const a = num(o);
  const b = num(n);
  if (a == null || b == null || d === "none") return "Target changed";
  const pts = Math.round(Math.abs(b - a) * 1000) / 10;
  return `${d === "up" ? "Up" : "Down"} ${pts} ${pts === 1 ? "point" : "points"}`;
}

/* ------------------------------------------------------------------ sell prices */

function priceDetail(o: unknown, n: unknown): string {
  const a = num(o);
  const b = num(n);
  if (a == null && b == null) return "";
  if (a == null) return "Price set";
  if (b == null) return "Price cleared";
  if (a === b) return "No change";
  const diff = b - a;
  const pct = a !== 0 ? ` (${diff > 0 ? "+" : "-"}${Math.abs(Math.round((diff / a) * 1000) / 10)}%)` : "";
  return `${diff > 0 ? "+" : "-"}${fmtMoney(Math.abs(diff))}${pct}`;
}

/** One sell price row can hold a normal price change and a happy hour price change: up to two events. */
export function sellPriceEvents(r: SellPriceRow, lk: Lookups = NO_LOOKUPS): ChangeEvent[] {
  let name = "";
  let venueId: number | undefined = r.venue_id ?? undefined;
  let refHref: string | undefined;
  try {
    if (r.kind === "beer_serve") {
      const beer = r.beer_id ? lk.beerName(r.beer_id) : undefined;
      const serve = r.serve_id ? lk.beerServeName(r.serve_id) : undefined;
      name = [beer?.name ?? "A tap beer", serve].filter(Boolean).join(" ");
      venueId ??= beer?.venueId;
      if (beer && r.beer_id) refHref = `/beers/${r.beer_id}`;
    } else if (r.kind === "gelato_serve") {
      const serve = r.serve_id ? lk.gelatoServeName(r.serve_id) : undefined;
      name = serve?.name ?? "A gelato serve";
      venueId ??= serve?.venueId;
      if (serve) refHref = "/gelato/serves";
    } else {
      const item = r.item_id ? lk.itemName(r.item_id) : undefined;
      name = item?.name ?? "A menu item";
      venueId ??= item?.venueId;
      if (item && r.item_id) refHref = `/items/${r.item_id}`;
    }
  } catch {
    name = name || "A menu item";
  }
  const at = iso(r.changed_at);
  const by = who(r.changed_by);
  const out: ChangeEvent[] = [];
  const make = (suffix: string, title: string, o: unknown, n: unknown) => {
    const d = dirOf(o, n);
    out.push({ id: `sell:${r.id}${suffix}`, at, who: by, kind: "sell_price", title, detail: priceDetail(o, n), oldValue: num(o) == null ? "None" : fmtMoney(o), newValue: num(n) == null ? "None" : fmtMoney(n), venueId, refHref, direction: d, tone: toneOf(d, true) });
  };
  if (num(r.old_price) !== num(r.new_price)) make("", `${name} sell price`, r.old_price, r.new_price);
  if (num(r.old_hh_price) !== num(r.new_hh_price)) make(":hh", `${name} happy hour price`, r.old_hh_price, r.new_hh_price);
  if (!out.length) make("", `${name} sell price`, r.old_price, r.new_price);
  return out;
}

/* ------------------------------------------------------------------ ingredient prices */

export function ingredientPriceEvent(r: PriceLogRow, lk: Lookups = NO_LOOKUPS): ChangeEvent {
  const name = (r.ingredient_id ? lk.ingredientName(r.ingredient_id) : undefined) ?? "An ingredient";
  const d = dirOf(r.old_price, r.new_price);
  const extra = [r.source ? `Source: ${r.source}` : "", r.notes ?? ""].filter(Boolean).join(" · ");
  const pd = priceDetail(r.old_price, r.new_price);
  return {
    id: `price:${r.id}`,
    at: iso(r.changed_at),
    who: who(r.entered_by),
    kind: "ingredient_price",
    title: `${name} pack price`,
    detail: [pd, extra].filter(Boolean).join(" · "),
    oldValue: num(r.old_price) == null ? "None" : fmtMoney(r.old_price),
    newValue: num(r.new_price) == null ? "None" : fmtMoney(r.new_price),
    refHref: r.ingredient_id && lk.ingredientName(r.ingredient_id) ? `/ingredients/${r.ingredient_id}` : undefined,
    direction: d,
    tone: toneOf(d, false),
  };
}

/* ------------------------------------------------------------------ combine, filter, group */

/** All three sources into one list, newest first (ties broken by id so the order never jumps). */
export function buildChangeLog(src: { audit?: AuditRow[] | null; sell?: SellPriceRow[] | null; prices?: PriceLogRow[] | null }, lk: Lookups = NO_LOOKUPS): ChangeEvent[] {
  const out: ChangeEvent[] = [];
  for (const r of src.audit ?? []) out.push(auditEvent(r, lk));
  for (const r of src.sell ?? []) out.push(...sellPriceEvents(r, lk));
  for (const r of src.prices ?? []) out.push(ingredientPriceEvent(r, lk));
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

export type ChangeFilter = "all" | "targets" | "prices" | "ingredients" | "settings" | "access";
export const FILTERS: { value: ChangeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "targets", label: "Targets" },
  { value: "prices", label: "Prices" },
  { value: "ingredients", label: "Ingredients" },
  { value: "settings", label: "Settings" },
  { value: "access", label: "Access" },
];

export function matchesFilter(e: ChangeEvent, f: ChangeFilter): boolean {
  switch (f) {
    case "all": return true;
    case "targets": return e.kind === "target" || e.kind === "override";
    case "prices": return e.kind === "sell_price" || e.kind === "ingredient_price";
    case "ingredients": return e.kind === "ingredient_price" || e.kind === "ingredient_detail";
    case "settings": return e.kind === "setting";
    case "access": return e.kind === "access";
  }
}

export function matchesSearch(e: ChangeEvent, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return [e.title, e.detail, e.who ?? "unknown", e.oldValue, e.newValue].some((t) => t.toLowerCase().includes(s));
}

const tz = "Australia/Brisbane";
/** yyyy-mm-dd in Brisbane. */
export function brisbaneDayKey(at: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}
/** "Fri 25 Sep" (adds the year when it is not the current Brisbane year). */
export function brisbaneDayLabel(at: string | Date, now: Date = new Date()): string {
  const parts = (d: Date) => Object.fromEntries(new Intl.DateTimeFormat("en-AU", { timeZone: tz, weekday: "short", day: "numeric", month: "short", year: "numeric" }).formatToParts(d).map((p) => [p.type, p.value]));
  const p = parts(new Date(at));
  const label = `${p.weekday} ${p.day} ${p.month.slice(0, 3)}`; // some ICU versions say "Sept"
  return p.year !== parts(now).year ? `${label} ${p.year}` : label;
}
/** "2:14 pm" in Brisbane. */
export function brisbaneTime(at: string | Date): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(at)).replace(/\bam\b/i, "am").replace(/\bpm\b/i, "pm");
}

export interface DayGroup {
  key: string;
  label: string;
  events: ChangeEvent[];
}
/** Events (already newest first) grouped by Brisbane day, newest day first. */
export function groupByDay(events: ChangeEvent[], now: Date = new Date()): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const e of events) {
    const key = brisbaneDayKey(e.at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.events.push(e);
    else groups.push({ key, label: brisbaneDayLabel(e.at, now), events: [e] });
  }
  return groups;
}

/** True when a Supabase error only means the table has not been created yet (migration not applied). */
export function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const m = String(err.message ?? "").toLowerCase();
  return err.code === "42P01" || err.code === "PGRST205" || m.includes("does not exist") || m.includes("schema cache") || m.includes("could not find the table");
}

/** Plain text report for pasting into a message. */
export function changeLogReportText(events: ChangeEvent[], label = "All venues", now: Date = new Date()): string {
  const head = `Change Log, ${label}\nPrinted ${brisbaneDayLabel(now, now)} ${brisbaneTime(now)} (Brisbane time)\n${events.length} ${events.length === 1 ? "change" : "changes"}`;
  const lines = [head];
  for (const g of groupByDay(events, now)) {
    lines.push(`\n${g.label}`);
    for (const e of g.events) lines.push(`- ${brisbaneTime(e.at)}, ${e.who ?? "Unknown"}: ${e.title}, ${e.oldValue} to ${e.newValue}${e.detail && e.detail !== "Changed" ? ` (${e.detail})` : ""}`);
  }
  return lines.join("\n");
}
