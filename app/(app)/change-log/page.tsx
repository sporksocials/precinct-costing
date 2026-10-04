"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, ChevronRight, Copy, Printer, RefreshCw } from "lucide-react";
import { useStore } from "@/lib/store";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import {
  FILTERS,
  brisbaneDayLabel,
  brisbaneTime,
  changeLogReportText,
  groupByDay,
  isMissingTable,
  matchesFilter,
  matchesSearch,
  type AuditRow,
  type ChangeEvent,
  type ChangeFilter,
  type PriceLogRow,
  type SellPriceRow,
} from "@/lib/change-log";
import { HISTORY_PAGE, buildFullChangeLog, fetchChangeHistory, pageOf, type HistoryLookups, type HistoryRow } from "@/lib/change-history";
import { DataTable, type Column } from "@/components/table";
import { VenueFilter, VENUE_SHORT, useVenue } from "@/components/venue";
import { Chips, Empty, ListSkeleton, PageHeader, SearchField, cx } from "@/components/ui";
import { usePersonName } from "@/components/use-person-name";

const LIMIT = 500;
/** events shown per page before "Show Older Changes" */
const PAGE = 100;

const CSS = `
@media print {
  @page { size: A4 landscape; margin: 9mm; }
  html, body { background: #fff !important; color: #000 !important; }
  aside, nav[aria-label="Main"] { display: none !important; }
  div[class*="lg:pl-"] { padding-left: 0 !important; }
  main { max-width: none !important; padding: 0 !important; }
  .log-print { --bg: #fff; --surface: #fff; --surface-2: #f2f2f2; --fill: #eee; --label: #000; --label-2: #222; --label-3: #444; --separator: #888; --danger: #8a0f00; --good: #0b5a25;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; color: #000; }
  .log-print table { font-size: 10px !important; }
  .log-print thead { display: table-header-group; }
  .log-print tr { break-inside: avoid; }
  .log-print a { text-decoration: none; color: inherit; }
}
`;

interface Raw {
  audit: AuditRow[];
  sell: SellPriceRow[];
  prices: PriceLogRow[];
  /** cost_change_history rows loaded so far (newest first); empty before the migration is applied */
  history: HistoryRow[];
  historyMore: boolean;
  notes: string[];
}

/** Read only: three small selects, newest first with the id as a unique tie-breaker. A missing table is just empty. */
async function fetchAll(): Promise<Raw> {
  const sb = getSupabaseBrowser();
  const notes: string[] = [];
  const pull = async <T,>(table: string, label: string): Promise<T[]> => {
    try {
      const { data, error } = await sb.from(table).select("*").order("changed_at", { ascending: false }).order("id", { ascending: false }).limit(LIMIT);
      if (error) {
        if (!isMissingTable(error)) notes.push(`${label} could not be loaded (${error.message}).`);
        return [];
      }
      return (data ?? []) as T[];
    } catch (e) {
      notes.push(`${label} could not be loaded (${e instanceof Error ? e.message : "unknown error"}).`);
      return [];
    }
  };
  const [audit, sell, prices, hist] = await Promise.all([
    pull<AuditRow>("cost_audit_log", "Targets, settings and access changes"),
    pull<SellPriceRow>("cost_sell_price_log", "Sell price changes"),
    pull<PriceLogRow>("cost_price_log", "Ingredient price changes"),
    fetchChangeHistory(sb, { limit: HISTORY_PAGE }),
  ]);
  if (hist.error) notes.push(`Full change history could not be loaded (${hist.error}).`);
  return { audit, sell, prices, history: hist.rows, historyMore: hist.hasMore, notes };
}

const TONE = { good: "text-good", bad: "text-danger", none: "text-label" } as const;

function DeletedTag() {
  return <span className="mr-1.5 inline-block rounded-md bg-danger-soft px-1.5 py-px align-[1px] text-[11px] font-semibold uppercase tracking-wide text-danger">Deleted</span>;
}

function Change({ e, className }: { e: ChangeEvent; className?: string }) {
  return (
    <span className={cx("inline-flex flex-wrap items-center gap-x-1.5 tnum", className)}>
      <span className="text-label-2">{e.oldValue}</span>
      <ArrowRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-label-3" strokeWidth={2.5} />
      <span className={cx("font-semibold", TONE[e.tone])}>{e.newValue}</span>
      {e.direction !== "none" ? <span className="sr-only">{e.direction === "up" ? "(up)" : "(down)"}</span> : null}
    </span>
  );
}

export default function ChangeLogPage() {
  const { venues, storedItems, preps, suppliers, offers, beers, beerServes, gelatoServes, ingredients } = useStore();
  const nameOf = usePersonName();
  const { venue, slug } = useVenue();
  const [raw, setRaw] = useState<Raw | null>(null);
  const [filter, setFilter] = useState<ChangeFilter>("all");
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState(false);
  const [pages, setPages] = useState(1);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const load = useCallback(() => {
    setRaw(null);
    setPages(1);
    void fetchAll().then(setRaw);
  }, []);
  useEffect(load, [load]);

  const lookups = useMemo<HistoryLookups>(() => {
    const vShort = new Map(venues.map((v) => [v.id, VENUE_SHORT[v.slug] ?? v.name]));
    const items = new Map(storedItems.map((i) => [i.id, { name: i.name, venueId: i.venue_id }]));
    const beerMap = new Map(beers.map((b) => [b.id, { name: b.name, venueId: b.venue_id }]));
    const serves = new Map(beerServes.map((s) => [s.id, s.name]));
    const gel = new Map(gelatoServes.map((s) => [s.id, { name: s.name, venueId: s.venue_id }]));
    const ing = new Map(ingredients.map((i) => [i.id, i.name]));
    const prepMap = new Map(preps.map((p) => [p.id, { name: p.name, venueId: p.venue_id }]));
    const supMap = new Map(suppliers.map((x) => [x.id, x.name]));
    const offerMap = new Map(offers.map((o) => [o.id, { name: o.name, venueId: o.venue_id }]));
    return {
      prepName: (id) => prepMap.get(id),
      supplierName: (id) => supMap.get(id),
      offerName: (id) => offerMap.get(id),
      recordName: () => undefined,
      personName: (email) => nameOf(email),
      venueName: (id) => vShort.get(id),
      itemName: (id) => items.get(id),
      beerName: (id) => beerMap.get(id),
      beerServeName: (id) => serves.get(id),
      gelatoServeName: (id) => gel.get(id),
      ingredientName: (id) => ing.get(id),
    };
  }, [venues, storedItems, preps, suppliers, offers, beers, beerServes, gelatoServes, ingredients, nameOf]);

  // changes made straight in the database (no signed-in person) read "System", never blank
  const all = useMemo(() => (raw ? buildFullChangeLog(raw, lookups).map((e) => ({ ...e, who: e.system ? "System" : nameOf(e.who) })) : []), [raw, lookups, nameOf]);
  const shown = useMemo(
    () => all.filter((e) => matchesFilter(e, filter) && matchesSearch(e, q) && (!venue || e.venueId == null || e.venueId === venue.id)),
    [all, filter, q, venue],
  );
  const paged = useMemo(() => pageOf(shown, pages, PAGE), [shown, pages]);
  const groups = useMemo(() => groupByDay(paged.shown), [paged]);
  const canLoadOlder = !paged.more && !!raw?.historyMore;
  const showOlder = async () => {
    if (paged.more) return setPages((p) => p + 1);
    if (!raw?.historyMore) return;
    setLoadingOlder(true);
    const next = await fetchChangeHistory(getSupabaseBrowser(), { limit: HISTORY_PAGE, offset: raw.history.length });
    setLoadingOlder(false);
    setRaw((r) => (r ? { ...r, history: [...r.history, ...next.rows], historyMore: next.hasMore, notes: next.error ? [...r.notes, `Older history could not be loaded (${next.error}).`] : r.notes } : r));
    setPages((p) => p + 1);
  };
  useEffect(() => setPages(1), [filter, q, slug]);
  const venueName = venue ? VENUE_SHORT[venue.slug] ?? venue.name : "All venues";
  const filtering = filter !== "all" || q.trim() !== "" || slug !== "all";

  const copy = async () => {
    const text = changeLogReportText(shown, venueName);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* nothing more to try */
      }
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const columns: Column<ChangeEvent>[] = [
    {
      key: "when",
      label: "When",
      sort: (e) => e.at,
      render: (e) => (
        <span className="block">
          <span className="block font-medium">{brisbaneTime(e.at)}</span>
          <span className="block text-[12px] text-label-2">{brisbaneDayLabel(e.at)}</span>
        </span>
      ),
    },
    { key: "who", label: "Who", sort: (e) => e.who ?? "Unknown", render: (e) => <span className={cx("text-[13px]", (!e.who || e.system) && "text-label-2")}>{e.who ?? "Unknown"}</span> },
    {
      key: "change",
      label: "Change",
      sort: (e) => e.title,
      className: "!whitespace-normal min-w-[16rem]",
      render: (e) => (
        <span className="block">
          <span className={cx("block font-medium", e.deleted && "text-danger")}>
            {e.deleted ? <DeletedTag /> : null}
            {e.title}
          </span>
          {e.detail ? <span className="block text-[12px] text-label-2">{e.detail}</span> : null}
        </span>
      ),
    },
    { key: "from", label: "From", render: (e) => <span className="text-label-2">{e.oldValue}</span> },
    { key: "to", label: "To", render: (e) => <span className={cx("font-semibold", TONE[e.tone])}>{e.newValue}</span> },
  ];

  const loading = raw == null;

  return (
    <div className="log-print">
      <style>{CSS}</style>
      <PageHeader title="Change Log" subtitle="Who changed what, and when. Brisbane time." />

      <div className="mt-3 flex flex-wrap gap-2 print:hidden">
        <button type="button" className="btn-plain" onClick={load}>
          <RefreshCw className="h-4 w-4" strokeWidth={2.25} /> Refresh
        </button>
        <button type="button" className="btn-plain" onClick={() => void copy()} disabled={loading || shown.length === 0}>
          {copied ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <Copy className="h-4 w-4" strokeWidth={2.25} />} {copied ? "Copied" : "Copy Report"}
        </button>
        <button type="button" className="btn-plain" onClick={() => window.print()} disabled={loading || shown.length === 0}>
          <Printer className="h-4 w-4" strokeWidth={2.25} /> Print
        </button>
      </div>

      <div className="mt-4 print:hidden">
        <VenueFilter stats={false} compact />
      </div>
      <div className="mt-3 space-y-3 print:hidden">
        <SearchField value={q} onChange={setQ} placeholder="Search changes, people or items" />
        <Chips ariaLabel="Type of change" options={FILTERS} value={filter} onChange={setFilter} />
      </div>
      <p className="hidden pt-1 text-[13px] print:block">
        {venueName} · {FILTERS.find((f) => f.value === filter)?.label} · {shown.length} changes
      </p>

      {raw?.notes.map((n) => (
        <p key={n} className="mt-3 text-[13px] text-warn" role="status">
          {n}
        </p>
      ))}

      {loading ? (
        <div className="mt-6">
          <ListSkeleton rows={6} />
        </div>
      ) : shown.length === 0 ? (
        filtering && all.length > 0 ? (
          <Empty title="No matching changes" body="Try another type, venue or search." />
        ) : (
          <Empty title="Nothing recorded yet" body="Changes made from now on appear here." />
        )
      ) : (
        <>
          {/* phones: grouped by day */}
          <div className="lg:hidden print:hidden">
            {groups.map((g) => (
              <section key={g.key} className="mt-6" aria-label={g.label}>
                <h2 className="px-4 pb-1.5 text-[15px] font-semibold text-label-2">{g.label}</h2>
                <div className="group-list">
                  {g.events.map((e) => {
                    const body = (
                      <>
                        <span className="min-w-0 flex-1">
                          <span className={cx("block break-words text-[17px] leading-snug", e.deleted ? "text-danger" : "text-label")}>
                            {e.deleted ? <DeletedTag /> : null}
                            {e.title}
                          </span>
                          <Change e={e} className="mt-0.5 text-[15px]" />
                          <span className="mt-0.5 block break-words text-[13px] leading-snug text-label-2">
                            {brisbaneTime(e.at)} · {e.who ?? "Unknown"}
                            {e.detail ? ` · ${e.detail}` : ""}
                          </span>
                        </span>
                        {e.refHref ? <ChevronRight className="-mr-1 h-[18px] w-[18px] shrink-0 text-label-3" strokeWidth={2.5} aria-hidden /> : null}
                      </>
                    );
                    const cls = cx("flex min-h-[48px] w-full items-center gap-3 px-4 py-2.5 text-left", e.deleted && "bg-danger-soft");
                    return e.refHref ? (
                      <Link key={e.id} href={e.refHref} className={cx(cls, "active:bg-fill hover:bg-[color:var(--fill)]")}>
                        {body}
                      </Link>
                    ) : (
                      <div key={e.id} className={cls}>
                        {body}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          {/* desktop and print: one table, newest first */}
          <div className="mt-6 hidden lg:block print:block">
            <DataTable rows={paged.shown} columns={columns} rowKey={(e) => e.id} href={(e) => e.refHref ?? ""} initialSort={{ key: "when", dir: "desc" }} rowClassName={(e) => (e.deleted ? "bg-danger-soft" : "")} />
            <p className="mt-2 text-[13px] text-label-2">
              Showing {paged.shown.length} of {shown.length} {shown.length === 1 ? "change" : "changes"} at {venueName}.
            </p>
          </div>
          {paged.more || canLoadOlder ? (
            <div className="mt-4 flex justify-center print:hidden">
              <button type="button" className="btn-plain" onClick={() => void showOlder()} disabled={loadingOlder}>
                {loadingOlder ? "Loading..." : "Show Older Changes"}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
