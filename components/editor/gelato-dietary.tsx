"use client";

import { useMemo } from "react";
import { useStore } from "@/lib/store";
import { ALLERGEN_NOTICE } from "@/lib/allergens";
import {
  cleanGelatoLabels,
  differenceNote,
  gelatoLabelsFor,
  GELATO_LABELS,
  shortNames,
  toggleGelatoLabel,
  type GelatoLabelDef,
  type GelatoLabelId,
  type GelatoLabelState,
} from "@/lib/gelato-labels";
import type { MenuItem, Prep, RecipeLine } from "@/lib/types";
import { Group, Toggle } from "../ui";

type Rec = MenuItem | Prep;

const PENDING_NOTE = "Labels can’t be set by hand until the database has its dietary labels update. The labels below are worked out from the ingredients.";

/** The line under a label: where it comes from, or why it is missing. */
function subFor(def: GelatoLabelDef, on: boolean, st: GelatoLabelState): string | undefined {
  const names = st.auto.sources[def.id] ?? [];
  const suggested = st.auto.labels.includes(def.id);
  if (def.kind === "contains") {
    if (on && suggested) return `From ${shortNames(names)}`;
    if (on) return "Not suggested by the ingredients";
    if (suggested) return `The ingredients suggest it: ${shortNames(names)}`;
    return undefined;
  }
  // a free label (Dairy Free, Vegan)
  if (on && !suggested) return "Not suggested by the ingredients";
  if (!on && names.length) return `${def.id === "vegan" ? "Not vegan" : "Has dairy"}: ${shortNames(names)}`;
  if (!on && !suggested) {
    if (st.auto.problems.length) return "An ingredient is missing, so this can’t be checked";
    if (st.auto.ingredientCount === 0) return "Add ingredients to work this out";
  }
  return undefined;
}

/**
 * Dietary Requirements for a gelato flavour: the six labels on the laminated sheet. Automatic until a person ticks one
 * (then the full list is stored on the flavour). Edits go into the editor draft like every other field, so the normal
 * Save bar, leave guard and conflict check apply.
 */
export function GelatoDietary({ rec, lines, setDraft }: { rec: Prep; lines: RecipeLine[]; setDraft: (fn: (d: Rec) => Rec) => void }) {
  const store = useStore();
  const ready = "dietary_labels" in rec;
  const st = useMemo(() => gelatoLabelsFor(rec, lines, store.index), [rec, lines, store.index]);
  const byHand = st.source === "set";
  const note = byHand ? differenceNote(st.missing, st.extra) : null;

  const write = (labels: GelatoLabelId[] | null) => setDraft((d) => ({ ...d, dietary_labels: labels }) as Rec);
  const tick = (id: GelatoLabelId, on: boolean) =>
    setDraft((d) => {
      const p = d as Prep;
      const current = Array.isArray(p.dietary_labels) ? cleanGelatoLabels(p.dietary_labels) : st.auto.labels;
      return { ...d, dietary_labels: toggleGelatoLabel(current, id, on) } as Rec;
    });

  return (
    <Group title="Dietary Requirements" className="mt-6" footer={ALLERGEN_NOTICE}>
      {!ready ? <p className="px-4 py-3 text-[13px] text-label-2">{PENDING_NOTE}</p> : null}

      <div className="flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-[17px] sm:text-[15px]">{byHand ? "Set by hand" : "Worked out from the ingredients"}</p>
          <p className="text-[13px] text-label-2">{byHand ? "The ingredients no longer change these" : "Changes as ingredients are added or removed"}</p>
        </div>
        {byHand ? (
          <button type="button" className="btn-plain !min-h-[44px] !px-3 !text-[14px] sm:!min-h-[34px]" onClick={() => write(null)}>
            Reset To Automatic
          </button>
        ) : null}
      </div>

      {note ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-warn-soft px-4 py-3">
          <p className="min-w-0 flex-1 text-[14px] text-warn">{note}</p>
          <button type="button" className="btn-plain !min-h-[44px] !px-3 !text-[14px] sm:!min-h-[34px]" onClick={() => write([...st.auto.labels])}>
            Use Suggestion
          </button>
        </div>
      ) : null}

      {GELATO_LABELS.map((def) => {
        const on = st.labels.includes(def.id);
        return (
          <div key={def.id} className={ready ? undefined : "pointer-events-none opacity-60"}>
            <Toggle checked={on} onChange={(v) => tick(def.id, v)} label={def.label} sub={subFor(def, on, st)} />
          </div>
        );
      })}
    </Group>
  );
}
