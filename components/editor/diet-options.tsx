"use client";

import React from "react";
import { TriangleAlert } from "lucide-react";
import { BADGE_LABELS, DIET_MARKS, DIET_OPTIONS, dietMarkDef, dietOptionDef, type DietMarkId, type DietOptionId } from "@/lib/diet-legend";
import { markOff, markOn, readMarks } from "@/lib/diet-options";
import type { MenuItem, RecipeLine } from "@/lib/types";
import { Group, Toggle, useToast } from "../ui";
import { BadgeLegend, SeafoodChip } from "../allergen-badges";
import { useBadgeModel } from "../allergen-picker";
import { useOptionCosts } from "./option-prices";
import { useOptionEditor } from "./option-sheet";
import { SafetyBlock } from "./safety-card";

/** The id the Finish Setting Up "Menu Labels" step scrolls to. */
export const MENU_LABELS_ID = "menu-labels";

/**
 * The block of this panel. On a food dish (`card`) it is a sibling block inside the shared Allergens And Dietary card (same heading,
 * explanation and spacing as Dish Allergens); anywhere else it is the plain grouped list it always was.
 */
function Section({ card, id, title, explain, trailing, footer, children }: { card?: boolean; id?: string; title: string; explain: string; trailing?: React.ReactNode; footer?: React.ReactNode; children: React.ReactNode }) {
  if (card)
    return (
      <SafetyBlock id={id} title={title} explain={explain} trailing={trailing} footer={footer}>
        {children}
      </SafetyBlock>
    );
  return (
    <Group title={title} className="mt-6" trailing={trailing} footer={footer}>
      {children}
    </Group>
  );
}

type Options = NonNullable<MenuItem["diet_options"]>;

/**
 * Menu Labels for a menu item (Troy, 10 Oct 2026: ONE name and ONE block for the marks and the options, the same words the Allergens tab uses
 * for its Menu Labels view), and "Marketed As Seafood". Edits go through the recipe editor's draft
 * (manual Save, leave guard, conflict check), like every other field.
 *
 * MARKS (GF, V, VG; Troy, 10 Oct 2026): three visible switches a chef or manager ticks. The app never works them out and
 * never ticks them itself. A dish marked GF cannot also offer GFO (V and VO, VG and VGO likewise): turning one on turns the
 * other off and says so. VG implies vegetarian, so a dish with both prints VG only.
 *
 * OPTIONS (GFO, VO, VGO, DFO): four visible switches. Switching one on opens the guided option sheet (option-sheet.tsx: leave
 * out, add, price, note) and its Done writes the option to the draft. A switched-on row is the switch plus ONE summary line
 * ("Leave out Pizza Base. Add GF Pizza Base 1 ea. +$3.00 · GP 71.2%") and an Edit button that reopens the sheet. An option is
 * saved when it has a note OR a swap. The options say what the kitchen can change on request: there is no safety check on
 * what is left.
 */
export function DietOptionsGroup({ item, lines, onPatch, card }: { item: MenuItem; lines: RecipeLine[]; onPatch: (p: Partial<MenuItem>) => void; card?: boolean }) {
  const ready = "diet_options" in item || "seafood_label" in item;
  const saved: Options = item.diet_options && typeof item.diet_options === "object" && !Array.isArray(item.diet_options) ? item.diet_options : {};
  const toast = useToast();
  const editor = useOptionEditor();
  const costs = useOptionCosts(item, lines);
  const marksOn = readMarks(saved);
  const { model } = useBadgeModel("item", item, lines);

  const isOn = (id: DietOptionId) => Object.prototype.hasOwnProperty.call(saved, id);
  const writeSaved = (next: Options) => onPatch({ diet_options: next });

  const toggleMark = (id: DietMarkId, on: boolean) => {
    if (!on) {
      writeSaved(markOff(saved, id));
      return;
    }
    const { next, clearedOption } = markOn(saved, id);
    const excluded = dietMarkDef(id).excludes;
    // the swap of an option a mark pushes out is kept for this visit, so switching the option back on restores it
    if (clearedOption) editor?.keep(clearedOption, saved[clearedOption]);
    writeSaved(next);
    if (clearedOption) toast.show({ message: `${dietOptionDef(excluded).name} turned off. A dish marked ${dietMarkDef(id).name} cannot also offer it.` });
  };

  const seafood = model.seafood;

  return (
    <Section card={card} id={MENU_LABELS_ID} title="Menu Labels" explain="Ticked by hand: GF, V and VG as served, and the swaps the kitchen offers (GFO, VO, VGO, DFO).">
      {!ready ? <p className="px-4 py-3 text-[13px] text-label-2">Menu Labels can’t be saved until the database has its menu labels update.</p> : null}
      {DIET_MARKS.map((m) => {
        const on = marksOn.includes(m.id);
        // vegan includes vegetarian: say so on the Vegetarian row rather than leaving it looking untouched
        const sub = m.id === "v" && !on && marksOn.includes("vg") ? "Included in Vegan. Prints once, as VG." : on && m.id === "v" && marksOn.includes("vg") ? "Vegan is also ticked. Prints once, as VG." : undefined;
        return (
          <Toggle
            key={m.id}
            label={
              <span>
                <span className="tnum font-semibold">{m.letter}</span> {m.name}
              </span>
            }
            sub={sub}
            checked={on}
            onChange={(v) => ready && toggleMark(m.id, v)}
          />
        );
      })}
      {DIET_OPTIONS.map((o) => {
        const on = isOn(o.id);
        const row = costs.find((c) => c.id === o.id);
        return (
          <div key={o.id}>
            <Toggle
              label={
                <span>
                  <span className="tnum font-semibold">{o.letter}</span> {o.name}
                </span>
              }
              sub={on ? undefined : o.detail}
              checked={on}
              onChange={(v) => {
                if (!ready) return;
                if (v) editor?.edit(o.id);
                else editor?.turnOff(o.id);
              }}
            />
            {on ? (
              <div className="flex items-center gap-3 px-4 pb-3">
                <p className="min-w-0 flex-1 text-[15px] leading-snug text-label-2 sm:text-[13px]" data-testid={`option-summary-${o.id}`}>
                  {row?.summary ?? "Nothing set yet. Tap Edit."}
                </p>
                <button type="button" className="btn-tinted !min-h-[44px] shrink-0" aria-label={`Edit ${o.name}`} onClick={() => editor?.edit(o.id)}>
                  Edit
                </button>
              </div>
            ) : null}
          </div>
        );
      })}

      <div>
        <Toggle
          label="Marketed As Seafood"
          sub="The dish name or description says seafood, so the menu needs an origin letter (A, I or M)."
          checked={!!item.seafood_label}
          onChange={(v) => ready && onPatch({ seafood_label: v })}
        />
        {item.seafood_label || seafood ? (
          <div className="px-4 pb-3">
            {seafood ? (
              <>
                <SeafoodChip s={seafood} />
                <p className="mt-1.5 text-[13px] text-label-2">
                  {"state" in seafood
                    ? `${BADGE_LABELS.originNotConfirmed}: set the origin on ${seafood.missing.slice(0, 4).join(", ")}${seafood.missing.length > 4 ? ` and ${seafood.missing.length - 4} more` : ""}.`
                    : seafood.required
                      ? "Worked out from the seafood ingredients. This letter goes on the menu."
                      : "Worked out from the seafood ingredients. Turn on Marketed As Seafood to print it."}
                </p>
              </>
            ) : (
              <p className="flex items-start gap-1.5 text-[13px] font-medium text-warn">
                <TriangleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
                No seafood ingredient found in this recipe yet.
              </p>
            )}
          </div>
        ) : null}
      </div>

      <details className="group px-4 py-3">
        <summary className="cursor-pointer text-[15px] text-accent sm:text-[13px]">Menu Legend</summary>
        <BadgeLegend className="mt-2" />
      </details>
    </Section>
  );
}
