"use client";

import Link from "next/link";
import React, { useMemo, useState } from "react";
import { Check, Plus, TriangleAlert, X } from "lucide-react";
import { allergenLabel, withDraft, type AllergenId } from "@/lib/allergens";
import { sameValue } from "@/lib/draft-changes";
import {
  DISH_ALLERGEN_IDS,
  NOTE_MAX,
  UNREADABLE_TEXT,
  addExtra,
  checkIngredientsHref,
  confirmAllergens,
  dishCheck,
  readDishAllergens,
  removeExtra,
  signOffState,
  sourceLines,
  staleSignOffText,
  unreviewedText,
  type DishCheck,
  type EditResult,
  type HintLine,
  type SignOffState,
} from "@/lib/dish-allergens";
import { dateWithYear } from "@/lib/record-created";
import { useStore } from "@/lib/store";
import type { MenuItem, RecipeLine } from "@/lib/types";
import { cx, Disclosure, useToast } from "../ui";
import { usePersonName } from "../use-person-name";
import { RecipeAllergens, useAllergenIndex } from "../allergen-picker";
import { DietOptionsGroup } from "./diet-options";
import { SAFETY_CARD_ID, SafetyBlock, SafetyCard, SafetyStatus } from "./safety-card";

/** The id the Finish Setting Up checklist and the post-save nudge scroll to: the shared Allergens And Dietary card. */
export const DISH_ALLERGENS_ID = SAFETY_CARD_ID;

type Sign = ReturnType<typeof useDishSignOff>;

/**
 * Where a food dish's allergens stand RIGHT NOW in the editor: what the ingredients give (through every nested prep), the ingredients
 * nobody has reviewed, and whether the sign-off is valid, changed since, legacy, or never made. One place, so the panel, the checklist
 * and the Active switch lock always agree (lib/dish-allergens.ts has the rules).
 */
export function useDishSignOff(item: MenuItem | null, lines: RecipeLine[]) {
  const base = useAllergenIndex();
  const idx = useMemo(() => (item ? withDraft(base, "item", item, lines) : base), [base, item, lines]);
  const check: DishCheck | null = useMemo(() => (item ? dishCheck(item, idx) : null), [item, idx]);
  const da = readDishAllergens(item?.dish_allergens);
  const state: SignOffState = check ? signOffState(da, check.live) : "never";
  return { da, check, state };
}

/**
 * Dish Allergens (ingredient first, Troy, 10 Oct 2026): a food dish's allergens are WORKED OUT from its ingredients (through every nested
 * prep) and shown here read only. Nobody ticks them on the dish: to change one, fix the ingredient. A person CONFIRMS the result, which
 * stamps the sign-off with a snapshot of the ingredients' ticks, so any later change to a component or a tick turns the dish back to Not
 * Checked ("Ingredients changed since <date>. Re-check and confirm again."). The only edits here are an extra allergen the ingredients do
 * not show (cross-contact, the menu says it contains it). A dish with an ingredient nobody has reviewed
 * cannot be confirmed: the panel names them and links to the ingredient review.
 *
 * Edits go through the recipe editor's draft (manual Save, leave guard, conflict check) like every other field, and take any earlier
 * confirmation away in the draft, with a toast saying so. The Allergy Matrix (/matrix, the print and the kitchen iPad) reads only what
 * is confirmed. Below the card, "What The Ingredients Say" keeps the full worked-out roll-up as a collapsed read-only reference.
 */
function DishAllergensBlock({ item, saved, onPatch, sign, onCleared }: { item: MenuItem; saved: MenuItem; onPatch: (p: Partial<MenuItem>) => void; sign: Sign; onCleared: () => void }) {
  const store = useStore();
  const toast = useToast();
  const ready = "dish_allergens" in item || "dish_allergens" in saved;
  const { check } = sign;
  if (!check) return null;

  const write = (res: EditResult) => {
    onPatch({ dish_allergens: res.next });
    if (res.clearedConfirmation) {
      onCleared();
      toast.show({ message: "Allergens changed, so the confirmation was cleared. Confirm Allergens again when you are done." });
    }
  };

  const sources = sourceLines(check.r, check.derived, check.added);

  return (
    <SafetyBlock
      title="Dish Allergens"
      explain="Worked out from the ingredients, so to change one, fix the ingredient. A person confirms it."
    >
      <div className="space-y-5 px-4">
        {!ready ? <p className="rounded-xl bg-fill px-3 py-2 text-[13px] text-label-2">Dish allergens can’t be saved until the database has its dish allergens update.</p> : null}

        <div>
          <p className="pb-2 text-[13px] font-medium text-label-2">Contains</p>
          <ContainsChips contains={check.contains} added={check.added} blocked={check.blocked} disabled={!ready} onRemoveExtra={(id) => write(removeExtra(item.dish_allergens, id, check.derived))} />
          <SourceList lines={sources} />
        </div>

        <AddAllergen contained={check.contains} disabled={!ready} onAdd={(id) => write(addExtra(item.dish_allergens, id, check.derived))} />
      </div>
    </SafetyBlock>
  );
}

/**
 * The ONE confirmation for the whole Allergens And Dietary card (Troy, 10 Oct 2026: "do the confirmation thing under the entire
 * allergens and dietary section"): it sits at the bottom, after Menu Labels, so the person reads the allergens and the labels and
 * then confirms once. What it says and why it may be disabled (an ingredient nobody has reviewed) sit right above the button. The
 * confirmation stamps the allergens (see confirmAllergens); it does not stamp the Menu Labels.
 */
function ConfirmFooter({ item, saved, onPatch, sign, cleared, onConfirmed }: { item: MenuItem; saved: MenuItem; onPatch: (p: Partial<MenuItem>) => void; sign: Sign; cleared: boolean; onConfirmed: () => void }) {
  const store = useStore();
  const toast = useToast();
  const ready = "dish_allergens" in item || "dish_allergens" in saved;
  const { da, check, state } = sign;
  if (!check) return null;
  const confirmed = state === "valid";
  const dirty = !sameValue(item.dish_allergens ?? null, saved.dish_allergens ?? null);
  const signedOn = da?.confirmedAt ? dateWithYear(da.confirmedAt) : "";
  const stale = staleSignOffText(state, signedOn);
  const confirm = () => {
    onPatch({ dish_allergens: confirmAllergens(item.dish_allergens, store.userEmail, new Date().toISOString(), { derived: check.derived, components: check.live.components, ticks: check.live.ticks }) });
    onConfirmed();
    toast.show({ message: "Confirmed. Save to put it on the matrix." });
  };
  return (
    <div className="space-y-3 border-t border-[color:var(--separator)] px-4 py-4" data-testid="confirm-footer">
      {stale ? (
        <p className="flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2.5 text-[13px] font-medium text-warn" role="status">
          <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
          <span>{stale}</span>
        </p>
      ) : cleared && !confirmed ? (
        <p className="text-[13px] font-medium text-warn">Changed. Confirm again when you are done.</p>
      ) : null}
      <BlockerNotice check={check} dishId={item.id} />
      {!confirmed && !check.blocked && !check.contains.length && ready ? <p className="text-[13px] text-label-2">Confirming says this dish contains none of the 15 allergens.</p> : null}
      {confirmed ? (
        <p className="text-[13px] text-label-2">{dirty ? "Save to keep this on the matrix." : "Confirmed. This dish is on the matrix."}</p>
      ) : (
        <>
          <p className="text-[13px] text-label-2">Shows Not Checked on the matrix until confirmed.</p>
          <button type="button" className="btn-primary !min-h-[44px] !px-4 !text-[15px]" disabled={!ready || check.blocked} onClick={confirm}>
            {stale ? "Confirm Again" : "Confirm Allergens"}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * The whole food safety section of a food dish (Troy, 10 Oct 2026): ONE shared card, "Allergens And Dietary", holding Dish Allergens,
 * Menu Labels (the GF, V, VG marks and GFO, VO, VGO, DFO options, one block) as sibling blocks (same headings, spacing, helper text and 44px controls), with a status line in
 * the header that says whether the section is done. Nothing is collapsed. Below it, "What The Ingredients Say" keeps the worked-out
 * roll-up as a collapsed read-only reference (the only collapsed thing).
 */
export function AllergensDietaryCard({ item, saved, lines, onPatch }: { item: MenuItem; saved: MenuItem; lines: RecipeLine[]; onPatch: (p: Partial<MenuItem>) => void }) {
  const nameOf = usePersonName();
  const sign = useDishSignOff(item, lines);
  // the sign-off was taken away by an edit in this visit (so the footer can say why it reads Not confirmed)
  const [cleared, setCleared] = useState(false);
  const { da, state } = sign;
  const signedOn = da?.confirmedAt ? dateWithYear(da.confirmedAt) : "";
  const who = da?.confirmedBy ? nameOf(da.confirmedBy) ?? da.confirmedBy : null;
  // the header says who and when once confirmed; when ingredients changed, the Dish Allergens block spells out the date and what to do
  const detail = state === "valid" ? `Confirmed${who ? ` by ${who}` : ""} on ${signedOn}` : null;
  return (
    <>
      <SafetyCard className="mt-7" status={<SafetyStatus state={state} detail={detail} />}>
        <DishAllergensBlock item={item} saved={saved} onPatch={onPatch} sign={sign} onCleared={() => setCleared(true)} />
        <DietOptionsGroup item={item} lines={lines} onPatch={onPatch} card />
        <ConfirmFooter item={item} saved={saved} onPatch={onPatch} sign={sign} cleared={cleared} onConfirmed={() => setCleared(false)} />
      </SafetyCard>
      <Disclosure title="What The Ingredients Say" hint="Everything the ingredients point at, including name guesses nobody has checked. A reference only.">
        <RecipeAllergens kind="item" rec={item} lines={lines} readOnly embedded />
      </Disclosure>
    </>
  );
}

/**
 * Why a dish cannot be confirmed yet: ingredients nobody has reviewed (named, up to six) with a 44px button to the ingredient review, or a
 * recipe the roll-up cannot read. Nothing when the dish can be confirmed. Used by the dish editor and Review mode.
 */
export function BlockerNotice({ check, dishId }: { check: Pick<DishCheck, "unreviewed" | "problems">; dishId: string }) {
  if (!check.unreviewed.length && !check.problems) return null;
  return (
    <div className="rounded-xl bg-warn-soft px-3 py-3 text-warn" role="status">
      <p className="flex items-start gap-2 text-[13px] font-medium">
        <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
        <span>
          {check.unreviewed.length ? `${unreviewedText(check.unreviewed)}. This dish cannot be confirmed until ${check.unreviewed.length === 1 ? "it is" : "they are"}.` : ""}
          {check.unreviewed.length && check.problems ? " " : ""}
          {check.problems ? UNREADABLE_TEXT : ""}
        </span>
      </p>
      {check.unreviewed.length ? (
        <Link href={checkIngredientsHref(dishId)} className="btn-plain mt-2 !min-h-[44px] !px-4 !text-[15px] !text-label">
          Check These Ingredients
        </Link>
      ) : null}
    </div>
  );
}

/**
 * The allergens the dish contains, read only: one filled chip for each that the ingredients give, and each extra with an Added tag that
 * can be tapped off (the only chips that act). Nothing is ticked here. While an ingredient is unreviewed the list may be incomplete and says so.
 */
export function ContainsChips({ contains, added, blocked, disabled, onRemoveExtra }: { contains: readonly AllergenId[]; added: readonly AllergenId[]; blocked: boolean; disabled?: boolean; onRemoveExtra?: (id: AllergenId) => void }) {
  if (!contains.length) {
    return <p className="text-[15px] text-label-2 sm:text-[13px]">{blocked ? "None found so far. Some ingredients are not checked yet." : "None. The ingredients list none of the 15 allergens."}</p>;
  }
  return (
    <div className="flex flex-wrap gap-2" role="list" aria-label="Allergens this dish contains">
      {contains.map((id) => {
        const extra = added.includes(id);
        if (!extra || !onRemoveExtra) {
          return (
            <span key={id} role="listitem" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-accent-fill px-4 text-[15px] font-medium text-accent-on">
              <Check aria-hidden className="h-4 w-4" strokeWidth={3} />
              {allergenLabel(id)}
              {extra ? <span className="text-[12px] font-semibold opacity-80">Added</span> : null}
            </span>
          );
        }
        return (
          <button
            key={id}
            type="button"
            role="listitem"
            disabled={disabled}
            onClick={() => onRemoveExtra(id)}
            aria-label={`Remove ${allergenLabel(id)}, added by hand`}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-accent-fill px-4 text-[15px] font-medium text-accent-on transition-transform duration-200 ease-ios active:scale-[0.97] disabled:opacity-50"
          >
            <Check aria-hidden className="h-4 w-4" strokeWidth={3} />
            {allergenLabel(id)}
            <span className="text-[12px] font-semibold opacity-80">Added</span>
            <X aria-hidden className="-mr-1 h-4 w-4 opacity-80" strokeWidth={2.5} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * "Where These Come From": under the chips, one plain line for each allergen the dish contains and what puts it there, such as
 * "Nitrites · Bacon". The primary list: the allergens are not ticked on the dish, so this is how a person checks them.
 */
export function SourceList({ lines }: { lines: readonly HintLine[] }) {
  if (!lines.length) return null;
  return (
    <div className="mt-3 rounded-xl bg-fill px-3 py-2.5">
      <p className="text-[13px] font-medium text-label-2">Where These Come From</p>
      <ul className="mt-1 space-y-1">
        {lines.map((l) => (
          <li key={l.id} className="text-[13px] leading-snug text-label-2">
            <span className="font-semibold text-label">{l.label}</span>
            <span className="text-label-3"> · </span>
            {l.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * "Add An Allergen": a quiet control for EXTRAS only, an allergen the ingredients do not show (cross-contact, or the menu says the dish
 * contains it). Closed it is one 44px text button; open it offers the allergens not already on the dish as 44px chips. There is no
 * way to take a derived allergen off: that needs the ingredient fixed.
 */
export function AddAllergen({ contained, disabled, onAdd }: { contained: readonly AllergenId[]; disabled?: boolean; onAdd: (id: AllergenId) => void }) {
  const [open, setOpen] = useState(false);
  const options = DISH_ALLERGEN_IDS.filter((id) => !contained.includes(id));
  if (!options.length) return null;
  return (
    <div>
      <button type="button" className="btn-text -ml-2 !min-h-[44px] !gap-1.5 !px-2 !text-[15px] !text-accent" aria-expanded={open} disabled={disabled} onClick={() => setOpen((o) => !o)}>
        <Plus aria-hidden className={cx("h-4 w-4 transition-transform duration-200", open && "rotate-45")} strokeWidth={2.5} />
        Add An Allergen
      </button>
      {open ? (
        <div className="anim-fade">
          <p className="pb-2 text-[13px] text-label-2">Only for something the ingredients do not show, such as cross-contact.</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Add an allergen to this dish">
            {options.map((id) => (
              <button
                key={id}
                type="button"
                disabled={disabled}
                onClick={() => {
                  onAdd(id);
                  setOpen(false);
                }}
                className="inline-flex min-h-[44px] items-center rounded-full bg-fill px-4 text-[15px] font-medium text-label transition-[background-color,transform] duration-200 ease-ios hover:bg-fill-2 active:scale-[0.97] disabled:opacity-50"
              >
                {allergenLabel(id)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

