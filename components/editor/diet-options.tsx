"use client";

import React, { useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { BADGE_LABELS, DIET_MARKS, DIET_OPTIONS, dietMarkDef, dietOptionDef, type DietMarkId, type DietOptionId } from "@/lib/diet-legend";
import { markOff, markOn, optionOnClearsMark, readMarks } from "@/lib/diet-options";
import type { DietOptionEntry, MenuItem, RecipeLine } from "@/lib/types";
import { Group, Toggle, useToast } from "../ui";
import { BadgeLegend, SeafoodChip } from "../allergen-badges";
import { useBadgeModel } from "../allergen-picker";
import { OptionSwapPanel } from "./diet-option-swap";
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
 * OPTIONS (GFO, VO, VGO, DFO): four visible switches, each asking "What changes?" when on, then which ingredients the option
 * leaves out, which it adds, a surcharge and its own costing (components/editor/diet-option-swap.tsx). An option is only ever
 * saved with a note. Turning one on shows the note field; until it has text the option stays out of the draft and the row
 * says so. The options say what the kitchen can change on request: there is no safety check on what is left.
 */
export function DietOptionsGroup({ item, lines, onPatch, card }: { item: MenuItem; lines: RecipeLine[]; onPatch: (p: Partial<MenuItem>) => void; card?: boolean }) {
  const ready = "diet_options" in item || "seafood_label" in item;
  const saved: Options = item.diet_options && typeof item.diet_options === "object" && !Array.isArray(item.diet_options) ? item.diet_options : {};
  const [pending, setPending] = useState<Set<DietOptionId>>(new Set());
  const toast = useToast();
  // the swap of an option that was switched off or pushed out by a mark, kept for this visit so switching it back on restores it
  const stash = useRef(new Map<DietOptionId, DietOptionEntry>());
  const marksOn = readMarks(saved);
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
  /** Removes an option from the draft, keeping its swap for this visit so switching it back on restores it. */
  const dropOption = (from: Options, id: DietOptionId): Options => {
    const e = from[id];
    if (e) stash.current.set(id, e);
    const next = { ...from };
    delete next[id];
    return next;
  };

  const toggle = (id: DietOptionId, on: boolean) => {
    if (on) {
      // a mark that cannot sit beside this option goes off, with a plain note saying so
      const { next, clearedMark } = optionOnClearsMark(saved, id);
      if (clearedMark) {
        writeSaved(next);
        toast.show({ message: `${dietMarkDef(clearedMark).name} turned off. A dish marked ${dietMarkDef(clearedMark).name} cannot also offer ${dietOptionDef(id).name}.` });
      }
      setPend(id, true); // on screen only; saved once it has a note
      return;
    }
    setPend(id, false);
    if (Object.prototype.hasOwnProperty.call(saved, id)) writeSaved(dropOption(saved, id));
  };
  const commitNote = (id: DietOptionId, text: string) => {
    const note = text.trim();
    if (note) {
      setPend(id, false);
      if (saved[id]?.note !== note) {
        const keep = saved[id] ?? stash.current.get(id) ?? {};
        stash.current.delete(id);
        writeSaved({ ...saved, [id]: { ...keep, note } });
      }
    } else {
      setPend(id, true);
      if (Object.prototype.hasOwnProperty.call(saved, id)) writeSaved(dropOption(saved, id));
    }
  };
  /** Merges a change into one option's entry (the leave-out ticks, added lines and surcharge); an emptied field is removed, not stored as empty. */
  const patchEntry = (id: DietOptionId, patch: Partial<DietOptionEntry>) => {
    const cur = saved[id];
    if (!cur) return;
    const entry: Record<string, unknown> = { ...cur, ...patch };
    for (const k of Object.keys(patch)) {
      const v = (patch as Record<string, unknown>)[k];
      if (v === undefined || v === null) delete entry[k];
    }
    writeSaved({ ...saved, [id]: entry as unknown as DietOptionEntry });
  };

  const toggleMark = (id: DietMarkId, on: boolean) => {
    if (!on) {
      writeSaved(markOff(saved, id));
      return;
    }
    const { next, clearedOption } = markOn(saved, id);
    const excluded = dietMarkDef(id).excludes;
    const wasPending = pending.has(excluded);
    if (clearedOption) {
      const e = saved[clearedOption];
      if (e) stash.current.set(clearedOption, e);
    }
    setPend(excluded, false);
    writeSaved(next);
    if (clearedOption || wasPending) toast.show({ message: `${dietOptionDef(excluded).name} turned off. A dish marked ${dietMarkDef(id).name} cannot also offer it.` });
  };

  const needNote = DIET_OPTIONS.filter((o) => pending.has(o.id) && !saved[o.id]?.note?.trim());
  const seafood = model.seafood;

  return (
    <Section
      card={card}
      id={MENU_LABELS_ID}
      title="Menu Labels"
      explain="Ticked by hand, never worked out by the app: GF, V and VG as served, and the swaps the kitchen offers (GFO, VO, VGO, DFO), with no check on what is left."
      trailing={needNote.length ? <span className="text-[13px] font-medium text-warn">{needNote.length} {needNote.length === 1 ? "option needs" : "options need"} a note</span> : null}
    >
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
        const entry = saved[o.id];
        const note = entry?.note ?? "";
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
                {entry && note.trim() ? <OptionSwapPanel item={item} lines={lines} def={o} entry={entry} onPatch={(p) => patchEntry(o.id, p)} /> : null}
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
