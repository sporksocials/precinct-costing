"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Check, CircleHelp, TriangleAlert, X, type LucideIcon } from "lucide-react";
import {
  GUEST_GROUPS,
  MATRIX_COLUMNS,
  MATRIX_LEGEND,
  STATE_WORD,
  buildRows,
  guestHeading,
  guestNeedsMulti,
  instruction,
  matrixSections,
  signedOffDate,
  uncolumnedContains,
  type MatrixCell,
  type MatrixColumnId,
  type MatrixRow,
  type MatrixState,
} from "@/lib/allergy-matrix";
import { crossContactLine } from "@/lib/allergy-matrix";
import { allergenLabel } from "@/lib/allergens";
import { syncedLabel } from "@/lib/bar";
import { dietMarkDef, dietOptionDef, DIET_OPTION_IDS } from "@/lib/diet-legend";
import type { KitchenMatrixData } from "@/lib/kitchen-matrix";
import { cx } from "../ui";
import { MX, toneStyle } from "./palette";
import { BackBar, CARD, Chevron, EmptyState, HEADING, StaleBanner } from "./parts";

/**
 * The kitchen Allergy Matrix (Troy, 10 Oct 2026): the laminated sheet on the iPad, so a cook can answer a guest in a tap.
 * Public, no login, like the rest of the Kitchen Station; the data is the narrow `cost_kitchen_matrix` feed (display fields only,
 * never a price). This is the ONE kitchen screen that lists allergens, by Troy's decision: the law requires the kitchen to have it.
 *
 *  - The grid: dishes down the side, Troy's columns across (the whole sheet on a landscape iPad; scrolls sideways on a portrait one
 *    with the dish names fixed on the left).
 *  - Tap one or more column headings, then See Guest Needs: every dish sorted into Can Eat, Can Eat With Changes, Cannot Eat and Not
 *    Checked for a guest who needs ALL of the picks (green only if green for every pick; red if any pick is red; see
 *    `guestNeedsMulti` in lib/allergy-matrix.ts). A visible count and Clear All sit above the grid.
 *  - Large Text (a switch in the footer, remembered on this iPad): everything about 25 percent bigger.
 *  - The venue's cross-contact line is the footer of every screen and is always visible.
 *  - Tap a dish: a card with every answer in plain words, the option swaps and the head chef's sign-off.
 * Every cell has its colour, an icon AND a word. A dish nobody has signed off reads grey, Not checked, never green.
 */

const IDLE_MS = 120_000; // back to the matrix after 2 minutes untouched on a guest or dish screen
const REFRESH_MS = 5 * 60_000;
const RETRY_MS = 30_000;
const ALL = "all";

const ICON: Record<MatrixState, LucideIcon> = { red: X, yellow: TriangleAlert, green: Check, grey: CircleHelp };

type View = { kind: "grid" } | { kind: "guest" } | { kind: "dish"; id: string; fromGuest: boolean };

const LARGE_KEY = "kitchen-matrix-large-text";
/** how much bigger Large Text makes everything (about 25 percent) */
export const LARGE_ZOOM = 1.25;

/** The Large Text switch, remembered on this iPad. Storage can be blocked or full, so every read and write is guarded and the screen works without it. */
function useLargeText(): [boolean, (v: boolean) => void] {
  const [large, setLarge] = useState(false);
  useEffect(() => {
    try {
      setLarge(window.localStorage.getItem(LARGE_KEY) === "1");
    } catch {
      /* storage blocked: stays off */
    }
  }, []);
  const set = useCallback((v: boolean) => {
    setLarge(v);
    try {
      window.localStorage.setItem(LARGE_KEY, v ? "1" : "0");
    } catch {
      /* not remembered, still on for this visit */
    }
  }, []);
  return [large, set];
}

export function KitchenMatrix({ slug, venueName, initial }: { slug: string; venueName: string; initial: KitchenMatrixData | null }) {
  const [data, setData] = useState<KitchenMatrixData | null>(initial);
  const [view, setView] = useState<View>({ kind: "grid" });
  const [section, setSection] = useState(ALL);
  const [picks, setPicks] = useState<MatrixColumnId[]>([]);
  const [large, setLarge] = useLargeText();
  const togglePick = useCallback((c: MatrixColumnId) => setPicks((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c])), []);
  const [now, setNow] = useState(() => (initial ? Date.parse(initial.syncedAt) : 0));

  // ---------- background refresh (keeps the last good copy when the network drops) ----------
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/kitchen/${slug}/matrix`, { cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as KitchenMatrixData;
      setData((prev) => (prev && Date.parse(next.syncedAt) < Date.parse(prev.syncedAt) ? prev : next));
    } catch {
      // offline: keep showing what we have; "Synced ... ago" tells the truth
    }
  }, [slug]);

  useEffect(() => {
    const id = window.setInterval(() => void refresh(), data ? REFRESH_MS : RETRY_MS);
    return () => window.clearInterval(id);
  }, [refresh, data]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && (!data || Date.now() - Date.parse(data.syncedAt) > 60_000)) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh, data]);

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const rows = useMemo(() => (data ? buildRows(data.dishes) : []), [data]);
  const sections = useMemo(() => matrixSections(rows), [rows]);
  const activeSection = sections.some((s) => s.label === section) ? section : ALL;
  const shown = activeSection === ALL ? sections : sections.filter((s) => s.label === activeSection);
  const shownRows = useMemo(() => shown.flatMap((s) => s.rows), [shown]);

  // a dish that disappears in a refresh drops back to the grid, so Back never lands on nothing
  const dishRow = view.kind === "dish" ? rows.find((r) => r.dish.id === view.id) ?? null : null;
  useEffect(() => {
    if (view.kind === "dish" && !dishRow) setView({ kind: "grid" });
  }, [view, dishRow]);

  const viewKey = view.kind === "grid" ? "grid" : view.kind === "guest" ? "guest" : `dish:${view.id}`;
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [viewKey]);

  const toGrid = useCallback(() => setView({ kind: "grid" }), []);
  useEffect(() => {
    if (view.kind === "grid") return;
    let t = window.setTimeout(toGrid, IDLE_MS);
    const reset = () => {
      window.clearTimeout(t);
      t = window.setTimeout(toGrid, IDLE_MS);
    };
    const events = ["pointerdown", "touchstart", "wheel", "scroll", "keydown"] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      window.clearTimeout(t);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [view.kind, viewKey, toGrid]);

  const stale = <StaleBanner syncedAt={data?.syncedAt ?? null} now={now} />;
  const root = cx(`kitchen-${slug}`, "kitchen-root flex min-h-[100dvh] w-full touch-manipulation flex-col bg-[#0E0E10] text-[#F5F3EE]");
  const crossContact = data?.crossContact ?? crossContactLine(null);
  const screen = (children: React.ReactNode) => (
    <div role="main" className={root}>
      {/* Large Text scales everything inside by about 25 percent (the footer is outside it so the switch never moves) */}
      <div className="flex flex-1 flex-col" style={large ? ({ zoom: LARGE_ZOOM } as React.CSSProperties) : undefined}>
        {children}
      </div>
      <Footer text={crossContact} large={large} onLarge={setLarge} />
    </div>
  );

  // ---------- one dish ----------
  if (data && view.kind === "dish" && dishRow) {
    const backLabel = view.fromGuest ? "BACK TO GUEST NEEDS" : "BACK TO MATRIX";
    return screen(
      <>
        <BackBar label={backLabel} onBack={() => setView(view.fromGuest ? { kind: "guest" } : { kind: "grid" })} />
        {stale}
        <DishCard row={dishRow} />
      </>,
    );
  }

  // ---------- guest needs ----------
  if (data && view.kind === "guest") {
    const needs = guestNeedsMulti(shownRows, picks);
    return screen(
      <>
        <BackBar label="BACK TO MATRIX" onBack={toGrid} />
        {stale}
        <div className="mx-auto w-full max-w-[1000px] px-6 pb-12 pt-6">
          <h1 className="font-display text-[44px] uppercase leading-none tracking-[1px]">{picks.length ? guestHeading(needs.columns) : "Guest Needs"}</h1>
          <p className="mt-2 text-[19px] leading-snug text-[#9B9890]">
            {picks.length > 1 ? "Dishes that suit a guest with ALL of these needs. " : "What a guest can have. "}Green needs nothing changed. Yellow can be made with the change shown.
          </p>
          <PickChips picks={picks} onToggle={togglePick} onClear={() => { setPicks([]); toGrid(); }} />
          {sections.length > 1 ? <SectionChips sections={sections.map((s) => s.label)} active={activeSection} onPick={setSection} /> : null}
          <div className="mt-5 space-y-4">
            {GUEST_GROUPS.map((g) => {
              const list = needs[g.key];
              return (
                <section key={g.key} aria-label={g.title} className={cx(CARD, "overflow-hidden")}>
                  <h2 className="flex items-center gap-3 px-5 py-4 text-[22px] font-semibold leading-tight" style={toneStyle(MX[g.key])}>
                    <StateIcon state={g.key} size={26} />
                    {g.title}
                    <span className="ml-auto text-[20px] font-bold">{list.length}</span>
                  </h2>
                  {list.length ? (
                    <ul>
                      {list.map((e, i) => (
                        <li key={e.row.dish.id} className={i ? "border-t-[0.5px] border-white/[0.07]" : ""}>
                          <button type="button" onClick={() => setView({ kind: "dish", id: e.row.dish.id, fromGuest: true })} className="flex min-h-[64px] w-full items-center gap-3 px-5 py-3 text-left active:bg-[#232327]">
                            <span className="min-w-0 flex-1">
                              <span className="block text-[22px] font-medium leading-tight">{e.row.dish.name}</span>
                              {e.state === "yellow"
                                ? e.notes.map((n) => (
                                    <span key={n.label} className="mt-1 block text-[20px] font-semibold leading-snug text-[#F2C46D]">
                                      {e.picks.length > 1 ? `${n.label}: ` : ""}
                                      {n.note}
                                    </span>
                                  ))
                                : null}
                              {e.row.dish.section && activeSection === ALL ? <span className="mt-0.5 block text-[16px] text-[#9B9890]">{e.row.dish.section}</span> : null}
                            </span>
                            <Chevron className="shrink-0 text-[#8E8C85]" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="px-5 py-4 text-[19px] text-[#9B9890]">None</p>
                  )}
                </section>
              );
            })}
          </div>
          {needs.grey.length ? <p className="mt-4 text-[17px] leading-snug text-[#9B9890]">Not Checked means the head chef has not signed that dish off yet. Do not tell a guest anything about it. Ask the head chef.</p> : null}
        </div>
      </>,
    );
  }

  // ---------- the grid ----------
  return screen(
      <div className="flex w-full flex-col">
        {stale}
        <div className="mx-auto w-full max-w-[1400px] px-4 pb-4 pt-[calc(28px+env(safe-area-inset-top))] sm:px-6">
          <Link href={`/kitchen/${slug}`} className="inline-flex min-h-[44px] items-center gap-[6px] pr-3 text-[16px] font-medium text-[color:var(--bar-text)]">
            <span aria-hidden className="text-[18px] leading-none">
              &#8592;
            </span>
            Back To Recipes
          </Link>
          <div className="mt-[6px] flex items-baseline justify-between gap-4">
            <h1 className="font-display text-[48px] uppercase leading-none tracking-[1px]">Allergy Matrix</h1>
            {data ? (
              <p className="shrink-0 text-[14px] text-[#9B9890]" aria-live="polite">
                {syncedLabel(data.syncedAt, now)}
              </p>
            ) : null}
          </div>
          <p className="mt-[2px] text-[18px] text-[#9B9890]">{venueName}. Tap one or more headings to see what a guest with those needs can have. Tap a dish for the details.</p>

          {data ? <Legend /> : null}
          {data && sections.length > 1 ? <SectionChips sections={sections.map((s) => s.label)} active={activeSection} onPick={setSection} /> : null}
        </div>

        {/* the picks: always visible and sticky, so the count and Clear All stay in reach while the grid scrolls */}
        {data && rows.length ? (
          <div className="sticky top-0 z-10 border-y-[0.5px] border-white/[0.12] bg-[#0E0E10]/95 backdrop-blur">
            <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 sm:px-6">
              <p className="min-w-0 flex-1 basis-[220px] text-[19px] leading-snug" aria-live="polite">
                <span className="font-bold">
                  {picks.length} {picks.length === 1 ? "need" : "needs"} picked
                </span>
                <span className="text-[#9B9890]">{picks.length ? `: ${picks.map((id) => MATRIX_COLUMNS.find((c) => c.id === id)?.label).join(", ")}` : ". Tap the headings below."}</span>
              </p>
              <button type="button" onClick={() => setPicks([])} disabled={!picks.length} className="min-h-[56px] rounded-full px-5 text-[19px] font-semibold text-[color:var(--bar-text)] disabled:opacity-40">
                Clear All
              </button>
              <button
                type="button"
                disabled={!picks.length}
                onClick={() => setView({ kind: "guest" })}
                className="min-h-[56px] rounded-2xl bg-[color:var(--bar-accent)] px-6 text-[20px] font-bold text-[color:var(--bar-on)] active:opacity-90 disabled:opacity-40"
              >
                See Guest Needs
              </button>
            </div>
          </div>
        ) : null}

        <div className="mx-auto w-full max-w-[1400px] px-4 pb-10 sm:px-6">
          {!data ? (
            <EmptyState title="Can’t Load The Matrix" body="Check the iPad’s Wi-Fi. This screen tries again every 30 seconds." action={{ label: "Try Again", onClick: () => void refresh() }} />
          ) : !rows.length ? (
            <EmptyState title="No Dishes Yet" body="Dishes appear here once they are on the menu in the costing app." />
          ) : (
            <Grid sections={shown} showHeads={activeSection === ALL && sections.length > 1} picks={picks} onPick={togglePick} onDish={(id) => setView({ kind: "dish", id, fromGuest: false })} />
          )}
        </div>
      </div>,
  );
}

/** The footer of every screen: the venue's standing cross-contact line (always visible) and the Large Text switch. */
function Footer({ text, large, onLarge }: { text: string; large: boolean; onLarge: (v: boolean) => void }) {
  return (
    <footer className="sticky bottom-0 z-20 border-t-[0.5px] border-white/[0.18] bg-[#1C1C1F] pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex w-full max-w-[1400px] items-center gap-4 px-4 py-3 sm:px-6">
        <p className={cx("min-w-0 flex-1 font-semibold leading-snug text-[#F2C46D]", large ? "text-[22px]" : "text-[17px]")}>{text}</p>
        <button
          type="button"
          role="switch"
          aria-checked={large}
          onClick={() => onLarge(!large)}
          className="flex min-h-[56px] shrink-0 items-center gap-3 rounded-full border-[0.5px] border-white/[0.18] bg-[#232327] px-5 text-[17px] font-semibold active:bg-[#2C2C31]"
        >
          Large Text
          <span aria-hidden className={cx("relative inline-flex h-[31px] w-[51px] items-center rounded-full", large ? "bg-[color:var(--bar-accent)]" : "bg-white/[0.2]")}>
            <span className={cx("inline-block h-[27px] w-[27px] rounded-full bg-white transition-transform", large ? "translate-x-[22px]" : "translate-x-[2px]")} />
          </span>
          <span className="sr-only">{large ? "On" : "Off"}</span>
        </button>
      </div>
    </footer>
  );
}

/** The needs picked so far as 56px toggles (add or remove one), with a count and Clear All. Used above the grid and on the guest screen. */
function PickChips({ picks, onToggle, onClear }: { picks: MatrixColumnId[]; onToggle: (c: MatrixColumnId) => void; onClear: () => void }) {
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[19px] font-semibold" aria-live="polite">
          {picks.length} {picks.length === 1 ? "need" : "needs"} picked
        </p>
        <button type="button" onClick={onClear} disabled={!picks.length} className="min-h-[56px] rounded-full px-5 text-[19px] font-semibold text-[color:var(--bar-text)] disabled:opacity-40">
          Clear All
        </button>
      </div>
      <div className="mt-1 flex flex-wrap gap-2" role="group" aria-label="Needs picked">
        {MATRIX_COLUMNS.map((c) => {
          const on = picks.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(c.id)}
              className={cx("min-h-[56px] rounded-full px-5 text-[19px] font-medium leading-[24px]", on ? "bg-[color:var(--bar-accent)] text-[color:var(--bar-on)]" : "border-[0.5px] border-white/[0.18] bg-transparent text-[#F5F3EE]")}
            >
              {on ? "\u2713 " : ""}
              {c.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StateIcon({ state, size = 22 }: { state: MatrixState; size?: number }) {
  const Icon = ICON[state];
  return <Icon aria-hidden width={size} height={size} strokeWidth={3} className="shrink-0" />;
}

function Legend() {
  const items: { s: MatrixState; text: string }[] = [
    { s: "red", text: "Cannot eat" },
    { s: "yellow", text: "Must be substituted, see the note" },
    { s: "green", text: "Can eat, no changes" },
    { s: "grey", text: "Not checked, ask the head chef" },
  ];
  return (
    <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2" aria-label={MATRIX_LEGEND}>
      {items.map(({ s, text }) => (
        <li key={s} className="flex items-center gap-2 text-[17px] leading-tight">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-[1.5px]" style={toneStyle(MX[s])}>
            <StateIcon state={s} size={18} />
          </span>
          {text}
        </li>
      ))}
    </ul>
  );
}

function SectionChips({ sections, active, onPick }: { sections: string[]; active: string; onPick: (s: string) => void }) {
  return (
    <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Section">
      {[ALL, ...sections].map((s) => {
        const on = s === active;
        return (
          <button
            key={s}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(s)}
            className={cx("min-h-[56px] rounded-full px-6 py-[10px] text-[19px] font-medium leading-[24px]", on ? "bg-[color:var(--bar-accent)] text-[color:var(--bar-on)]" : "border-[0.5px] border-white/[0.18] bg-transparent text-[#F5F3EE]")}
          >
            {s === ALL ? "All Sections" : s}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ the grid */

function AnswerCell({ cell, label }: { cell: MatrixCell; label: string }) {
  return (
    <span
      className="flex min-h-[64px] w-full flex-col items-center justify-center gap-0.5 rounded-lg border-[1.5px] px-1 py-1.5 text-center leading-tight"
      style={toneStyle(MX[cell.state])}
      aria-label={`${label}: ${STATE_WORD[cell.state]}${cell.note ? `, ${cell.note}` : ""}`}
    >
      <StateIcon state={cell.state} size={20} />
      <span className="text-[15px] font-bold">{STATE_WORD[cell.state]}</span>
      {cell.note ? <span className="line-clamp-3 text-[14px] font-semibold">{cell.note}</span> : null}
    </span>
  );
}

function Grid({ sections, showHeads, picks, onPick, onDish }: { sections: { label: string; rows: MatrixRow[] }[]; showHeads: boolean; picks: MatrixColumnId[]; onPick: (c: MatrixColumnId) => void; onDish: (id: string) => void }) {
  return (
    <div className={cx(CARD, "overflow-x-auto")}>
      <table className="w-full min-w-[1000px] border-separate border-spacing-0">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-[2] min-w-[170px] bg-[#1C1C1F] px-4 py-3 text-left align-bottom">
              <span className={HEADING}>DISH</span>
            </th>
            {MATRIX_COLUMNS.map((c) => (
              <th key={c.id} scope="col" className="min-w-[76px] p-1 align-bottom">
                <button
                  type="button"
                  onClick={() => onPick(c.id)}
                  aria-pressed={picks.includes(c.id)}
                  aria-label={`${c.label}: pick this need for a guest`}
                  className={cx(
                    "flex min-h-[64px] w-full items-center justify-center rounded-lg border-[0.5px] px-1 py-2 text-center text-[15px] font-semibold leading-tight active:bg-[#2C2C31]",
                    picks.includes(c.id) ? "border-transparent bg-[color:var(--bar-accent)] text-[color:var(--bar-on)]" : "border-white/[0.18] bg-[#232327] text-[#F5F3EE]",
                  )}
                >
                  {picks.includes(c.id) ? "\u2713 " : ""}
                  {c.label}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sections.map((s) => (
            <SectionBody key={s.label} label={s.label} rows={s.rows} showHead={showHeads} onDish={onDish} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionBody({ label, rows, showHead, onDish }: { label: string; rows: MatrixRow[]; showHead: boolean; onDish: (id: string) => void }) {
  return (
    <>
      {showHead ? (
        <tr>
          <th scope="rowgroup" className="sticky left-0 z-[1] whitespace-nowrap border-t-[0.5px] border-white/[0.07] bg-[#232327] px-4 py-2 text-left text-[18px] font-semibold text-[color:var(--bar-text)]">
            {label}
          </th>
          <td colSpan={MATRIX_COLUMNS.length} className="border-t-[0.5px] border-white/[0.07] bg-[#232327]" />
        </tr>
      ) : null}
      {rows.map((r) => (
        <tr key={r.dish.id}>
          <th scope="row" className="sticky left-0 z-[1] border-t-[0.5px] border-white/[0.07] bg-[#1C1C1F] p-0 text-left font-normal">
            <button type="button" onClick={() => onDish(r.dish.id)} className="block min-h-[64px] w-full px-4 py-2 text-left text-[19px] font-medium leading-tight active:bg-[#232327]">
              {r.dish.name}
            </button>
          </th>
          {MATRIX_COLUMNS.map((c) => (
            <td key={c.id} className="border-t-[0.5px] border-white/[0.07] p-1 align-middle">
              <button type="button" onClick={() => onDish(r.dish.id)} className="block w-full" aria-label={`${r.dish.name}, ${c.label}`}>
                <AnswerCell cell={r.cells[c.id]} label={c.label} />
              </button>
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ one dish */

function DishCard({ row }: { row: MatrixRow }) {
  const da = row.dish.allergens;
  const extra = uncolumnedContains(da);
  const options = DIET_OPTION_IDS.filter((id) => row.dish.options[id] !== undefined);
  return (
    <div className="mx-auto w-full max-w-[1000px] px-6 pb-12 pt-7">
      <h1 className="font-display text-[44px] uppercase leading-none tracking-[1px]">{row.dish.name}</h1>
      <p className="mt-2 text-[19px] text-[#9B9890]">{row.dish.section ?? "Other"}</p>
      <p className={cx("mt-3 flex items-center gap-2 text-[20px] font-semibold leading-snug", row.confirmed ? "text-[#8FD9A4]" : "text-[#F2C46D]")}>
        <StateIcon state={row.confirmed ? "green" : "grey"} size={22} />
        {row.confirmed && da?.confirmedAt ? `Allergens confirmed on ${signedOffDate(da.confirmedAt)}` : "Allergens not checked yet. Ask the head chef before you tell a guest anything."}
      </p>
      {extra.length ? (
        <p className={cx(CARD, "mt-4 px-5 py-4 text-[20px] font-semibold leading-snug")}>
          Also contains {extra.map(allergenLabel).join(" and ")}. There is no column for it on the sheet.
        </p>
      ) : null}

      <ul className="mt-5 grid gap-3 sm:grid-cols-2">
        {MATRIX_COLUMNS.map((c) => {
          const cell = row.cells[c.id];
          return (
            <li key={c.id} className="overflow-hidden rounded-2xl border-[1.5px]" style={{ borderColor: MX[cell.state].edge }}>
              <div className="flex items-center gap-3 px-4 py-3" style={toneStyle(MX[cell.state])}>
                <StateIcon state={cell.state} size={24} />
                <span className="min-w-0 flex-1 text-[21px] font-bold leading-tight">{c.label}</span>
                <span className="text-[19px] font-bold">{STATE_WORD[cell.state]}</span>
              </div>
              <p className="bg-[#1C1C1F] px-4 py-3 text-[19px] leading-snug">{instruction(cell)}</p>
            </li>
          );
        })}
      </ul>

      {options.length || row.dish.marks.length ? (
        <section className={cx(CARD, "mt-5 px-5 py-5")}>
          <h2 className={cx(HEADING, "mb-2")}>THIS DISH</h2>
          {row.dish.marks.length ? <p className="py-2 text-[20px] leading-snug">Marked: {row.dish.marks.map((m) => `${dietMarkDef(m).letter} ${dietMarkDef(m).name}`).join(", ")}</p> : null}
          {options.map((id) => (
            <p key={id} className="border-t-[0.5px] border-white/[0.07] py-3 text-[20px] leading-snug">
              <span className="font-bold text-[#EBD9B8]">{dietOptionDef(id).name}.</span> {row.dish.options[id]?.trim() || "See chef"}
            </p>
          ))}
        </section>
      ) : null}
      <p className="mt-5 text-[17px] leading-snug text-[#9B9890]">Confirm with the head chef if unsure.</p>
    </div>
  );
}
