"use client";

import Link from "next/link";
import React, { useState } from "react";
import { Check, ChevronDown, CircleHelp, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { MATRIX_COLUMNS, MATRIX_LEGEND, STATE_WORD, instruction, matrixColumn, uncolumnedContains, type MatrixCell, type MatrixRow, type MatrixSection, type MatrixState } from "@/lib/allergy-matrix";
import { allergenLabel } from "@/lib/allergens";
import { cx } from "../ui";

/**
 * Shared pieces of the costing app's Allergy Matrix screen. Four states, each with a colour, an icon AND a word, so the colour is
 * never the only signal: red No (X), yellow Swap (triangle with the note), green Yes (tick), grey Not checked (question mark).
 * Read only: no cell can be tapped to change it. A chef changes the dish in the recipe editor.
 */

export const TONE: Record<MatrixState, { box: string; text: string; Icon: LucideIcon }> = {
  red: { box: "bg-danger-soft", text: "text-danger", Icon: X },
  yellow: { box: "bg-warn-soft", text: "text-warn", Icon: TriangleAlert },
  green: { box: "bg-good-soft", text: "text-good", Icon: Check },
  grey: { box: "bg-fill-2 border border-dashed border-[color:var(--label-3)]", text: "text-label-2", Icon: CircleHelp },
};

/** One answer with its icon and word (and, on a yellow cell, the note). */
export function StateChip({ cell, label, compact, className }: { cell: MatrixCell; label?: string; compact?: boolean; className?: string }) {
  const t = TONE[cell.state];
  const Icon = t.Icon;
  return (
    <span
      className={cx("inline-flex items-center gap-1 rounded-full font-semibold", t.box, t.text, compact ? "px-2 py-1 text-[12px]" : "px-2.5 py-1 text-[13px]", className)}
      title={cell.state === "yellow" ? `${label ?? ""} ${STATE_WORD.yellow}: ${cell.note}`.trim() : label ? `${label}: ${STATE_WORD[cell.state]}` : STATE_WORD[cell.state]}
    >
      <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" strokeWidth={2.75} />
      {label ? <span>{label}</span> : <span>{STATE_WORD[cell.state]}</span>}
      <span className="sr-only">{`: ${STATE_WORD[cell.state]}${cell.note ? `, ${cell.note}` : ""}`}</span>
    </span>
  );
}

export function MatrixLegend({ className }: { className?: string }) {
  const sw = "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded";
  const items: { s: MatrixState; text: string }[] = [
    { s: "red", text: "Red: cannot eat" },
    { s: "yellow", text: "Yellow: must be substituted, see the note" },
    { s: "green", text: "Green: can eat with no substitutions" },
    { s: "grey", text: "Grey: not checked, ask the head chef" },
  ];
  return (
    <ul className={cx("flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-label-2", className)} aria-label="Legend">
      {items.map(({ s, text }) => {
        const t = TONE[s];
        const Icon = t.Icon;
        return (
          <li key={s} className="flex items-center gap-1.5">
            <span className={cx(sw, t.box, t.text)}>
              <Icon aria-hidden className="h-3.5 w-3.5" strokeWidth={2.75} />
            </span>
            {text}
          </li>
        );
      })}
      <li className="sr-only">{MATRIX_LEGEND}</li>
    </ul>
  );
}

/** What is wrong with a dish, in a line: not signed off, ingredients changed, or a mark that disagrees with its allergens. */
export function RowStatus({ row }: { row: MatrixRow }) {
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
      {row.confirmed ? <span className="text-label-2">Confirmed</span> : <span className="font-semibold text-warn">Not confirmed</span>}
      {row.needsReview ? (
        <span className="inline-flex items-center gap-1 font-semibold text-warn">
          <TriangleAlert aria-hidden className="h-3 w-3" strokeWidth={2.75} /> Check ingredients
        </span>
      ) : null}
      {row.warnings.length ? (
        <span className="inline-flex items-center gap-1 font-semibold text-warn" title={row.warnings.join(" ")}>
          <TriangleAlert aria-hidden className="h-3 w-3" strokeWidth={2.75} /> Marks disagree
        </span>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------ desktop table */

function Cell({ cell, label }: { cell: MatrixCell; label: string }) {
  const t = TONE[cell.state];
  const Icon = t.Icon;
  return (
    <span className={cx("flex min-h-[48px] w-full flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1 text-center leading-tight", t.box, t.text)} title={`${label}: ${STATE_WORD[cell.state]}${cell.note ? `, ${cell.note}` : ""}. ${cell.why}`}>
      <Icon aria-hidden className="h-4 w-4 shrink-0" strokeWidth={2.75} />
      <span className="text-[11px] font-bold">{STATE_WORD[cell.state]}</span>
      {cell.note ? <span className="line-clamp-4 text-[11px] font-medium">{cell.note}</span> : null}
    </span>
  );
}

/** The grid: dishes down the side, Troy's columns across. From lg; below that the screen shows cards. Sections get a heading row. */
export function MatrixTable({ sections, showSectionHeads }: { sections: readonly MatrixSection[]; showSectionHeads: boolean }) {
  return (
    <div className="hidden overflow-x-auto rounded-2xl bg-surface lg:block">
      <table className="w-full min-w-[1040px] border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-[2] min-w-[190px] bg-surface px-3 py-2 text-left text-[13px] font-medium text-label-2">
              Dish
            </th>
            {MATRIX_COLUMNS.map((c) => (
              <th key={c.id} scope="col" className="min-w-[78px] px-1 py-2 text-center align-bottom text-[12px] font-semibold leading-tight text-label-2">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sections.map((s) => (
            <React.Fragment key={s.label}>
              {showSectionHeads ? (
                <tr>
                  <th scope="rowgroup" className="sticky left-0 z-[1] whitespace-nowrap bg-surface-2 px-3 py-1.5 text-left text-[12px] font-semibold text-label-2">
                    {s.label}
                  </th>
                  <td colSpan={MATRIX_COLUMNS.length} className="bg-surface-2" />
                </tr>
              ) : null}
              {s.rows.map((r) => (
                <tr key={r.dish.id}>
                  <th scope="row" className="sticky left-0 z-[1] border-b border-[color:var(--separator)] bg-surface px-3 py-1.5 text-left align-middle font-normal">
                    <Link href={`/items/${r.dish.id}`} className="block text-[14px] font-medium leading-tight hover:underline">
                      {r.dish.name}
                    </Link>
                    <RowStatus row={r} />
                  </th>
                  {MATRIX_COLUMNS.map((c) => (
                    <td key={c.id} className="border-b border-[color:var(--separator)] p-0.5 align-middle">
                      <Cell cell={r.cells[c.id]} label={c.label} />
                    </td>
                  ))}
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ phone and tablet cards */

/** A dish as a card: its eleven answers as a chip row; tapping the card opens every answer in full words. */
export function DishCard({ row }: { row: MatrixRow }) {
  const [open, setOpen] = useState(false);
  const extra = uncolumnedContains(row.dish.allergens);
  return (
    <div className="rounded-2xl bg-surface">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="block w-full min-h-[44px] rounded-2xl p-4 text-left active:bg-surface-2">
        <span className="flex items-start gap-2">
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-semibold leading-tight">{row.dish.name}</span>
            <RowStatus row={row} />
          </span>
          <ChevronDown aria-hidden className={cx("mt-1 h-5 w-5 shrink-0 text-label-3 transition-transform", open && "rotate-180")} strokeWidth={2.25} />
        </span>
        <span className="mt-3 flex flex-wrap gap-1.5">
          {MATRIX_COLUMNS.map((c) => (
            <StateChip key={c.id} cell={row.cells[c.id]} label={c.short} compact />
          ))}
        </span>
      </button>
      {open ? (
        <div className="space-y-3 border-t border-[color:var(--separator)] px-4 pb-4 pt-3">
          <ul className="space-y-2.5">
            {MATRIX_COLUMNS.map((c) => {
              const cell = row.cells[c.id];
              const t = TONE[cell.state];
              const Icon = t.Icon;
              return (
                <li key={c.id} className="flex items-start gap-2.5">
                  <span className={cx("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded", t.box, t.text)}>
                    <Icon aria-hidden className="h-3.5 w-3.5" strokeWidth={2.75} />
                  </span>
                  <span className="min-w-0 text-[15px] leading-snug">
                    <span className="font-semibold">{matrixColumn(c.id).label}</span>
                    <span className="block text-label-2">{instruction(cell)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          {extra.length ? <p className="rounded-xl bg-fill px-3 py-2 text-[13px] text-label-2">Also listed on this dish, with no column on the sheet: {extra.map(allergenLabel).join(", ")}.</p> : null}
          {row.warnings.map((w) => (
            <p key={w} className="flex items-start gap-1.5 text-[13px] font-medium text-warn">
              <TriangleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
              {w}
            </p>
          ))}
          <Link href={`/items/${row.dish.id}`} className="btn-plain !min-h-[44px] !px-4 !text-[15px]">
            Open Recipe
          </Link>
        </div>
      ) : null}
    </div>
  );
}
