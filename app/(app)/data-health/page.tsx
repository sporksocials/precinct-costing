"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Copy, Printer, RefreshCw, XCircle } from "lucide-react";
import { useStore } from "@/lib/store";
import { CHECKS, formatBrisbane, reportText, severityRank, summarise, type Issue, type Severity } from "@/lib/integrity";
import { useDataHealth } from "@/lib/use-data-health";
import { DataTable, type Column } from "@/components/table";
import { VenueFilter, VENUE_SHORT, useVenue } from "@/components/venue";
import { Empty, ListSkeleton, PageHeader, Row, cx } from "@/components/ui";

/** Light, high contrast print styles (same approach as the allergen matrix): only the print block changes colours. */
const CSS = `
@media print {
  @page { size: A4 landscape; margin: 9mm; }
  html, body { background: #fff !important; color: #000 !important; }
  aside, nav[aria-label="Main"] { display: none !important; }
  div[class*="lg:pl-"] { padding-left: 0 !important; }
  main { max-width: none !important; padding: 0 !important; }
  .health-print { --bg: #fff; --surface: #fff; --surface-2: #f2f2f2; --fill: #eee; --label: #000; --label-2: #222; --label-3: #444; --separator: #888; --danger: #8a0f00; --danger-soft: #f4d4d0; --warn: #7a4a00; --warn-soft: #ffe9b8; --good: #0b5a25; --good-soft: #cdeed7;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; color: #000; }
  .health-print table { font-size: 10px !important; }
  .health-print thead { display: table-header-group; }
  .health-print tr { break-inside: avoid; }
  .health-print a { text-decoration: none; color: inherit; }
}
`;

const SEV: Record<Severity, { label: string; plural: string; text: string; soft: string; Icon: typeof XCircle }> = {
  error: { label: "Error", plural: "Errors", text: "text-danger", soft: "bg-danger-soft", Icon: XCircle },
  warning: { label: "Warning", plural: "Warnings", text: "text-warn", soft: "bg-warn-soft", Icon: AlertTriangle },
  info: { label: "Note", plural: "Notes", text: "text-label-2", soft: "bg-fill", Icon: CheckCircle2 },
};
const KIND_LABEL: Record<Issue["kind"], string> = { item: "Menu item", prep: "Prep", ingredient: "Ingredient", offer: "Special or combo", beer: "Tap beer", setting: "Setting" };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function SevBadge({ s }: { s: Severity }) {
  const { label, text, soft, Icon } = SEV[s];
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold", text, soft)}>
      <Icon aria-hidden className="h-3.5 w-3.5" strokeWidth={2.5} />
      {label}
    </span>
  );
}

export default function DataHealthPage() {
  const store = useStore();
  const { result, recheck, acceptLineCounts } = useDataHealth();
  const { venue, slug } = useVenue();
  const [copied, setCopied] = useState(false);

  const all = useMemo(() => result?.issues ?? [], [result]);
  const shown = useMemo(() => (slug === "all" ? all : all.filter((i) => !i.venue || i.venue === slug)), [all, slug]);
  const venueName = venue ? VENUE_SHORT[venue.slug] ?? venue.name : "All venues";
  const total = useMemo(() => summarise(all), [all]);
  const counts = useMemo(() => summarise(shown), [shown]);

  const bySeverity = useMemo(
    () =>
      (["error", "warning", "info"] as Severity[])
        .map((sev) => {
          const list = shown.filter((i) => i.severity === sev);
          const byCode = new Map<string, Issue[]>();
          for (const i of list) byCode.set(i.code, [...(byCode.get(i.code) ?? []), i]);
          return { sev, list, groups: [...byCode.entries()] };
        })
        .filter((s) => s.list.length),
    [shown],
  );

  const copy = async () => {
    if (!result) return;
    const text = reportText(shown, result.checkedAt, venueName);
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

  const columns: Column<Issue>[] = [
    {
      key: "record",
      label: "Record",
      sort: (i) => i.name,
      render: (i) => (
        <span className="block max-w-[16rem]">
          <span className="block truncate font-medium">{i.name}</span>
          <span className="block text-[12px] text-label-2">{KIND_LABEL[i.kind]}</span>
        </span>
      ),
    },
    { key: "severity", label: "Level", sort: (i) => severityRank(i.severity), render: (i) => <SevBadge s={i.severity} /> },
    { key: "check", label: "Check", sort: (i) => i.title, className: "!whitespace-normal min-w-[12rem]", render: (i) => <span className="text-[13px]">{i.title}</span> },
    {
      key: "meaning",
      label: "What this means",
      className: "!whitespace-normal min-w-[22rem]",
      render: (i) => (
        <span className="block text-[13px] leading-snug">
          {i.detail}
          <span className="mt-1 block text-[12px] text-label-2">Why it matters: {CHECKS[i.code]?.why}</span>
        </span>
      ),
    },
    { key: "venue", label: "Venue", sort: (i) => i.venue ?? "", render: (i) => <span className="text-[13px] text-label-2">{i.venue ? VENUE_SHORT[i.venue] ?? i.venue : "All"}</span> },
  ];

  const ready = !store.loading && !!result;
  const tone = total.attention === 0 ? "good" : total.errors > 0 ? "danger" : "warn";

  return (
    <div className="health-print">
      <style>{CSS}</style>
      <PageHeader title="Data Health" subtitle="Checks on the data loaded right now" />

      {/* overall status */}
      {!ready ? (
        <div className="rounded-2xl bg-surface p-4">
          <p className="text-[17px] font-semibold">Checking your data</p>
          <p className="mt-0.5 text-[13px] text-label-2">This takes a moment after the app loads.</p>
        </div>
      ) : (
        <div className={cx("flex items-start gap-3.5 rounded-2xl p-4", tone === "good" && "bg-good-soft", tone === "danger" && "bg-danger-soft", tone === "warn" && "bg-warn-soft")} role="status">
          <span className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-full", tone === "good" && "bg-good text-[#0b1f12]", tone === "danger" && "bg-danger text-[#2a0a07]", tone === "warn" && "bg-warn text-[#2a1a00]")}>
            {tone === "good" ? <Check aria-hidden className="h-6 w-6" strokeWidth={3} /> : <AlertTriangle aria-hidden className="h-6 w-6" strokeWidth={2.5} />}
          </span>
          <div className="min-w-0">
            <p className={cx("text-[20px] font-semibold leading-tight", tone === "good" && "text-good", tone === "danger" && "text-danger", tone === "warn" && "text-warn")}>
              {total.attention === 0 ? "All checks passed" : `${plural(total.attention, "issue")} ${total.attention === 1 ? "needs" : "need"} a look`}
            </p>
            {total.attention > 0 ? (
              <p className="mt-0.5 text-[15px] text-label">
                {plural(total.errors, "error")}, {plural(total.warnings, "warning")}
                {total.info ? `, ${plural(total.info, "note")}` : ""}
              </p>
            ) : total.info ? (
              <p className="mt-0.5 text-[15px] text-label">{plural(total.info, "note")} to read below.</p>
            ) : null}
            <p className="mt-1 text-[13px] text-label-2">
              Checked {formatBrisbane(result!.checkedAt)} Brisbane time. {Object.keys(CHECKS).length} checks across {result!.counts.ingredients.toLocaleString("en-AU")} ingredients, {result!.counts.preps.toLocaleString("en-AU")} preps,{" "}
              {result!.counts.items.toLocaleString("en-AU")} menu items and {result!.counts.lines.toLocaleString("en-AU")} recipe lines.
            </p>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2 print:hidden">
        <button type="button" className="btn-plain" onClick={recheck}>
          <RefreshCw className="h-4 w-4" strokeWidth={2.25} /> Check Again
        </button>
        <button type="button" className="btn-plain" onClick={() => void copy()} disabled={!ready}>
          {copied ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <Copy className="h-4 w-4" strokeWidth={2.25} />} {copied ? "Copied" : "Copy Report"}
        </button>
        <button type="button" className="btn-plain" onClick={() => window.print()} disabled={!ready}>
          <Printer className="h-4 w-4" strokeWidth={2.25} /> Print
        </button>
      </div>

      <div className="mt-4 print:hidden">
        <VenueFilter stats={false} compact />
      </div>
      <p className="hidden pt-1 text-[13px] print:block">
        {venueName} · printed {formatBrisbane(new Date())}
      </p>

      {!ready ? (
        <div className="mt-6">
          <ListSkeleton rows={4} />
        </div>
      ) : shown.length === 0 ? (
        <Empty
          title={total.attention === 0 && total.info === 0 ? "Nothing to fix" : `Nothing to fix at ${venueName}`}
          body={total.attention === 0 ? "Costs, prices and recipes line up. This page checks again every time the app loads new data." : "The issues above belong to other venues. Choose All to see them."}
        />
      ) : (
        <>
          {/* phones: grouped rows, errors first */}
          <div className="lg:hidden print:hidden">
            {bySeverity.map(({ sev, list, groups }) => {
              const S = SEV[sev];
              return (
                <section key={sev} className="mt-7" aria-label={S.plural}>
                  <h2 className={cx("flex items-center gap-1.5 px-4 text-[17px] font-semibold", S.text)}>
                    <S.Icon aria-hidden className="h-[18px] w-[18px]" strokeWidth={2.5} /> {S.plural} ({list.length})
                  </h2>
                  {groups.map(([code, rows]) => (
                    <div key={code} className="mt-4">
                      <div className="px-4 pb-1.5">
                        <h3 className="text-[15px] font-medium text-label">
                          {CHECKS[code]?.title} ({rows.length})
                        </h3>
                        <p className="mt-0.5 text-[13px] text-label-2">Why it matters: {CHECKS[code]?.why}</p>
                        {code === "line_count_drop" ? (
                          <button type="button" className="btn-text mt-1 font-semibold" onClick={acceptLineCounts}>
                            Accept Current Line Counts
                          </button>
                        ) : null}
                      </div>
                      <div className="group-list">
                        {rows.map((i, n) => (
                          <Row
                            key={`${i.code}:${i.id}:${n}`}
                            href={i.fixHref}
                            title={i.name}
                            sub={i.detail}
                            wrapSub
                            chevron
                            trailing={i.venue ? <span className="text-[13px] text-label-2">{VENUE_SHORT[i.venue] ?? i.venue}</span> : undefined}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              );
            })}
          </div>

          {/* desktop and print: one sortable table */}
          <div className="mt-6 hidden lg:block print:block">
            {bySeverity.some((s) => s.groups.some(([c]) => c === "line_count_drop")) ? (
              <p className="mb-2 flex items-center gap-2 text-[13px] text-label-2 print:hidden">
                Some recipes have fewer lines than before. If you removed those lines on purpose:
                <button type="button" className="btn-text font-semibold" onClick={acceptLineCounts}>
                  Accept Current Line Counts
                </button>
              </p>
            ) : null}
            <DataTable rows={shown} columns={columns} rowKey={(i) => `${i.code}:${i.id}:${i.detail.length}`} href={(i) => i.fixHref} initialSort={{ key: "severity", dir: "asc" }} />
            <p className="mt-2 text-[13px] text-label-2">
              {plural(counts.errors, "error")}, {plural(counts.warnings, "warning")}
              {counts.info ? `, ${plural(counts.info, "note")}` : ""} at {venueName}.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
