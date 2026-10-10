"use client";

import React, { useMemo } from "react";
import { Check, Target, TrendingDown } from "lucide-react";
import { useStore } from "@/lib/store";
import { gpStatus } from "@/lib/dashboard";
import { optionCost, optionSummary, type OptionCost } from "@/lib/diet-option-cost";
import { dietOptionDef, type DietOptionDef, type DietOptionId } from "@/lib/diet-legend";
import { readOfferedOptions } from "@/lib/diet-options";
import { gp, money } from "@/lib/format";
import type { MenuItem, RecipeLine } from "@/lib/types";
import { cx } from "../ui";
import { useOptionEditor } from "./option-sheet";

/**
 * The separate costing of every dietary option a dish offers (GFO, VO, VGO, DFO), for the dish page only (Troy, 10 Oct 2026:
 * "that should show up in the right hand price panel as the GFO option GP% etc."). DISPLAY ONLY: this is built from the editor's
 * DRAFT through `optionCost`, and nothing here reaches Home, alerts, GP averages, the Menu list, price suggestions or the To Do hub.
 */

export interface OptionCostRow {
  id: DietOptionId;
  def: DietOptionDef;
  oc: OptionCost;
  /** "Leave out Pizza Base. Add GF Pizza Base 1 ea. +$3.00 · GP 71.2%" */
  summary: string;
}

/** One costed row per option the draft offers, in the order GFO, VO, VGO, DFO. Recomputed live as the draft changes. */
export function useOptionCosts(item: MenuItem, lines: readonly RecipeLine[]): OptionCostRow[] {
  const store = useStore();
  const own = useMemo(() => lines.filter((l) => l.component_id), [lines]);
  return useMemo(
    () =>
      readOfferedOptions(item.diet_options).flatMap((read) => {
        const oc = optionCost(item, own, read, { index: store.index, settings: store.settings, targets: store.targets });
        return oc ? [{ id: read.id, def: dietOptionDef(read.id), oc, summary: optionSummary(oc, money) }] : [];
      }),
    [item, own, store.index, store.settings, store.targets],
  );
}

const tone = (level: "good" | "warn" | "bad" | "none") => (level === "good" ? "text-good" : level === "warn" ? "text-warn" : "text-danger");

/**
 * The Options list: one tappable row per option that is on, with its letter, its price inc GST and its own GP with the status
 * word and icon (never colour alone). Tapping a row opens that option's sheet. Nothing renders when no option is on.
 */
export function OptionPrices({ item, lines, className }: { item: MenuItem; lines: readonly RecipeLine[]; className?: string }) {
  const rows = useOptionCosts(item, lines);
  const editor = useOptionEditor();
  if (!rows.length) return null;
  return (
    <section aria-label="Options" className={className} data-testid="option-prices">
      <p className="eyebrow text-[12px] text-label-2">Options</p>
      <ul className="mt-1.5 divide-y-[0.5px] divide-[color:var(--separator)]">
        {rows.map(({ id, def, oc }) => {
          const status = oc.gpPct != null ? gpStatus(oc.gpPct, oc.targetGp) : null;
          const Icon = status?.level === "good" ? Check : status?.level === "warn" ? Target : TrendingDown;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => editor?.edit(id)}
                aria-label={`${def.name}: ${oc.priceInc != null ? money(oc.priceInc) : "no price"}${status && oc.gpPct != null ? `, GP ${gp(oc.gpPct, 1, oc.targetGp)}, ${status.word}` : ""}. Edit`}
                className="flex min-h-[44px] w-full items-center gap-3 py-1.5 text-left active:opacity-70"
              >
                <span className="tnum w-11 shrink-0 text-[17px] font-bold sm:text-[15px]">{def.letter}</span>
                <span className="min-w-0 flex-1 text-[17px] tnum sm:text-[15px]">{oc.priceInc != null ? money(oc.priceInc) : <span className="text-label-2">No price</span>}</span>
                {status && oc.gpPct != null ? (
                  <span className={cx("flex shrink-0 flex-col items-end leading-tight", tone(status.level))}>
                    <span className="text-[17px] font-semibold tnum sm:text-[15px]">GP {gp(oc.gpPct, 1, oc.targetGp)}</span>
                    <span className="flex items-center gap-1 text-[13px] font-semibold">
                      <Icon aria-hidden className="h-3.5 w-3.5" strokeWidth={3} />
                      {status.word}
                    </span>
                  </span>
                ) : (
                  <span className="shrink-0 text-[13px] text-label-2">No GP yet</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-[12px] text-label-3">Tap an option to change it.</p>
    </section>
  );
}
