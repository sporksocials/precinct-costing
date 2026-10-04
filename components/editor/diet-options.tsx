"use client";

import React, { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { BADGE_LABELS, DIET_OPTIONS, type DietOptionId } from "@/lib/diet-legend";
import type { MenuItem, RecipeLine } from "@/lib/types";
import { Group, Toggle } from "../ui";
import { BadgeLegend, SeafoodChip } from "../allergen-badges";
import { useBadgeModel } from "../allergen-picker";

type Options = NonNullable<MenuItem["diet_options"]>;

/**
 * Dietary Options for a menu item: four visible switches (GFO, VO, VGO, DFO), each asking "What changes?" when on, and
 * "Marketed As Seafood". Edits go through the recipe editor's draft, so they autosave like every other field.
 *
 * An option is only ever saved with a note. Turning one on shows the note field; until it has text the option stays out
 * of the draft (the autosave never sees it) and the row says so. Whether a dish IS gluten free is never typed here: the
 * options say what the kitchen can change on request, and "No Gluten Ingredients" is worked out from the ingredients.
 */
export function DietOptionsGroup({ item, lines, onPatch }: { item: MenuItem; lines: RecipeLine[]; onPatch: (p: Partial<MenuItem>) => void }) {
  const ready = "diet_options" in item || "seafood_label" in item;
  const saved: Options = item.diet_options && typeof item.diet_options === "object" ? item.diet_options : {};
  const [pending, setPending] = useState<Set<DietOptionId>>(new Set());
  const { model } = useBadgeModel("item", item, lines);

  const isOn = (id: DietOptionId) => Object.prototype.hasOwnProperty.call(saved, id) || pending.has(id);
  const setPend = (id: DietOptionId, on: boolean) =>
    setPending((p) => {
      const n = new Set(p);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const writeSaved = (next: Options) => onPatch({ diet_options: next });

  const toggle = (id: DietOptionId, on: boolean) => {
    if (on) {
      setPend(id, true); // on screen only; saved once it has a note
      return;
    }
    setPend(id, false);
    if (Object.prototype.hasOwnProperty.call(saved, id)) {
      const next = { ...saved };
      delete next[id];
      writeSaved(next);
    }
  };
  const commitNote = (id: DietOptionId, text: string) => {
    const note = text.trim();
    if (note) {
      setPend(id, false);
      if (saved[id]?.note !== note) writeSaved({ ...saved, [id]: { note } });
    } else {
      setPend(id, true);
      if (Object.prototype.hasOwnProperty.call(saved, id)) {
        const next = { ...saved };
        delete next[id];
        writeSaved(next);
      }
    }
  };

  const needNote = DIET_OPTIONS.filter((o) => pending.has(o.id) && !saved[o.id]?.note?.trim());
  const seafood = model.seafood;

  return (
    <Group
      title="Dietary Options"
      className="mt-6"
      trailing={needNote.length ? <span className="pb-0.5 text-[13px] font-medium text-warn">{needNote.length} {needNote.length === 1 ? "option needs" : "options need"} a note</span> : null}
      footer="These say what the kitchen can change on request. They never claim the dish is gluten free: No Gluten Ingredients is worked out from the ingredients."
    >
      {!ready ? <p className="px-4 py-3 text-[13px] text-label-2">Dietary options can’t be saved until the database has its dietary options update.</p> : null}
      {DIET_OPTIONS.map((o) => {
        const on = isOn(o.id);
        const note = saved[o.id]?.note ?? "";
        const missing = on && !note.trim();
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
              onChange={(v) => ready && toggle(o.id, v)}
            />
            {on ? (
              <div className="px-4 pb-3">
                <NoteInput id={o.id} value={note} onCommit={(t) => commitNote(o.id, t)} />
                {missing ? (
                  <p className="mt-1.5 flex items-start gap-1.5 text-[13px] font-medium text-warn">
                    <TriangleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
                    Not saved yet. Say what changes to keep this option.
                  </p>
                ) : (
                  <p className="mt-1.5 text-[13px] text-label-2">Shown on the dish with this note.</p>
                )}
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
    </Group>
  );
}

/** "What changes?" input: commits on blur or Enter, like the other inline fields. */
function NoteInput({ id, value, onCommit }: { id: DietOptionId; value: string; onCommit: (t: string) => void }) {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setText(value);
  }
  return (
    <textarea
      rows={2}
      className="field resize-none"
      placeholder="What changes? e.g. Swap the bun for a gluten free bun"
      aria-label={`What changes for ${id.toUpperCase()}`}
      aria-required
      autoFocus={!value}
      value={text}
      enterKeyHint="done"
      onChange={(e) => setText(e.target.value.replace(/\n/g, " "))}
      onBlur={() => {
        if (text !== value) onCommit(text);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
    />
  );
}
