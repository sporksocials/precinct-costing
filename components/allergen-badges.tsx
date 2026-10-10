"use client";

import { Check, CircleHelp, Fish, Minus, OctagonAlert, Replace, TriangleAlert, Wine } from "lucide-react";
import { allergenLabel, type AllergenId } from "@/lib/allergens";
import type { BadgeModel, DietBadge, MarkBadge, OptionBadge, SeafoodBadge } from "@/lib/allergen-badges";
import { BADGE_LABELS, dietLegendLines, markLegendLines, LEGEND_INVITATION, seafoodDef, seafoodLegendLines } from "@/lib/diet-legend";
import { cx } from "./ui";

/**
 * The tiers of the badge model (lib/allergen-badges.ts), always in the same order:
 * Not Reviewed banner, Contains, Contains Alcohol, Dietary, Seafood Origin.
 * Every badge is a word plus a shape or icon, never colour alone: solid hard-edged = contains, dashed = unconfirmed,
 * hatched = not confirmed, quiet outline = attribute (alcohol), outlined with a swap icon = an option.
 */

const base = "inline-flex items-center gap-1.5 text-[14px] font-semibold leading-tight";
const icon = "h-4 w-4 shrink-0";

function TierLabel({ children }: { children: React.ReactNode }) {
  return <p className="pb-1.5 text-[12px] font-medium text-label-2">{children}</p>;
}

/** Amber and hatched, icon plus words: the first thing on any recipe with an unreviewed ingredient. */
export function NotReviewedBanner({ names, empty }: { names: string[]; empty?: boolean }) {
  return (
    <div role="alert" className="ab-hatch-warn flex items-start gap-3 rounded-xl border-2 border-[color:var(--warn)] px-3.5 py-3 text-warn">
      <TriangleAlert aria-hidden className="mt-0.5 h-6 w-6 shrink-0" strokeWidth={2.5} />
      <div className="min-w-0">
        <p className="text-[19px] font-bold leading-tight sm:text-[17px]">{BADGE_LABELS.notReviewed}</p>
        <p className="mt-1 text-[14px] font-medium text-label">
          {empty
            ? "This recipe has no ingredients yet, so nothing can be confirmed."
            : `${names.length} ${names.length === 1 ? "ingredient is" : "ingredients are"} not reviewed: ${names.slice(0, 5).join(", ")}${names.length > 5 ? ` and ${names.length - 5} more` : ""}. Anything not listed below may still apply.`}
        </p>
      </div>
    </div>
  );
}

export function ContainsBadge({ id }: { id: AllergenId }) {
  return (
    <span className={cx(base, "ab-solid-danger rounded-md px-2.5 py-1.5")}>
      <OctagonAlert aria-hidden className={icon} strokeWidth={2.5} />
      {allergenLabel(id)}
    </span>
  );
}
export function MayContainBadge({ id }: { id: AllergenId }) {
  return (
    <span className={cx(base, "rounded-md border-2 border-dashed border-[color:var(--warn)] bg-warn-soft px-2.5 py-1 text-warn")}>
      <CircleHelp aria-hidden className={icon} strokeWidth={2.5} />
      {allergenLabel(id)}
      <span className="text-[12px] font-semibold">Unconfirmed</span>
    </span>
  );
}
export function AlcoholBadge({ may }: { may?: boolean }) {
  return (
    <span className={cx(base, "rounded-full border border-[color:var(--label-3)] px-2.5 py-1 font-medium text-label-2", may && "border-dashed")}>
      <Wine aria-hidden className={icon} strokeWidth={2.25} />
      {BADGE_LABELS.containsAlcohol}
      {may ? <span className="text-[12px]">Unconfirmed</span> : null}
    </span>
  );
}

export function DietChip({ d }: { d: DietBadge }) {
  if (d.state === "is")
    return (
      <span className={cx(base, "ab-solid-good rounded-full px-3 py-1.5")}>
        <Check aria-hidden className={icon} strokeWidth={3} />
        {d.label}
      </span>
    );
  return (
    <span className={cx(base, "ab-hatch-grey rounded-full border border-dashed border-[color:var(--label-3)] px-3 py-1.5 font-medium text-label-2")}>
      <Minus aria-hidden className={icon} strokeWidth={2.5} />
      {d.label}: {BADGE_LABELS.notConfirmed}
    </span>
  );
}

/** A hand-set mark: the letters in a solid tag. Always a person's declaration, never derived. */
export function MarkChip({ k }: { k: MarkBadge }) {
  return (
    <span className={cx(base, "ab-solid-good rounded-2xl px-3 py-1.5")}>
      <Check aria-hidden className={icon} strokeWidth={3} />
      <span className="tnum font-bold">{k.letter}</span>
      <span className="font-medium">{k.label}</span>
    </span>
  );
}

export function OptionChip({ o }: { o: OptionBadge }) {
  return (
    <span className={cx(base, "rounded-2xl border-2 border-[color:var(--accent)] px-3 py-1.5 text-left text-accent")}>
      <Replace aria-hidden className={icon} strokeWidth={2.5} />
      <span className="tnum">{o.letter}</span>
      <span className="font-medium">{o.label}</span>
    </span>
  );
}

export function SeafoodChip({ s }: { s: SeafoodBadge }) {
  if ("letter" in s) {
    const def = seafoodDef(s.letter);
    return (
      <span className={cx(base, "rounded-full border-2 py-1 pl-1 pr-3", s.required ? "border-[color:var(--accent)] text-label" : "border-[color:var(--label-3)] font-medium text-label-2")}>
        <span aria-hidden className={cx("flex h-7 w-7 items-center justify-center rounded-full text-[15px] font-bold", s.required ? "bg-accent-fill text-accent-on" : "bg-fill-2 text-label")}>
          {s.letter}
        </span>
        <Fish aria-hidden className={icon} strokeWidth={2.25} />
        {def.label}
      </span>
    );
  }
  return (
    <span className={cx(base, "rounded-full border-2 border-dashed border-[color:var(--warn)] bg-warn-soft px-3 py-1.5 text-warn")}>
      <Fish aria-hidden className={icon} strokeWidth={2.5} />
      {BADGE_LABELS.originNotConfirmed}
    </span>
  );
}

/**
 * The whole badge panel for one recipe. `seafoodLabel` is the dish's "Marketed As Seafood" switch, so the panel can say
 * when the menu needs a letter and cannot get one. Read-only: editing lives in the allergen and dietary option editors.
 */
export function BadgePanel({ model, seafoodLabel, className }: { model: BadgeModel; seafoodLabel?: boolean; className?: string }) {
  const m = model;
  const mainEmpty = m.contains.length === 0 && m.mayContain.length === 0;
  const alc = m.attributes.length + m.attributesMay.length > 0;
  const seafood = m.seafood;
  return (
    <div className={cx("space-y-4", className)} data-testid="badge-panel">
      {m.notReviewed ? <NotReviewedBanner names={m.notReviewed.unreviewedNames} empty={m.notReviewed.unreviewedNames.length === 0} /> : null}

      {m.listsAllergens ? (
      <div>
        <TierLabel>{BADGE_LABELS.contains}</TierLabel>
        {mainEmpty ? (
          <p className="text-[15px] text-label-2">{m.notReviewed ? "Nothing found so far." : m.drink ? "No egg, milk, nuts or sulphites ticked on any ingredient." : "No allergens ticked on any ingredient."}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {m.contains.map((id) => (
              <ContainsBadge key={id} id={id} />
            ))}
            {m.mayContain.map((id) => (
              <MayContainBadge key={id} id={id} />
            ))}
          </div>
        )}
        {m.notes.length ? (
          <ul className="mt-2 space-y-0.5 text-[13px] text-label-2">
            {m.notes.map((n) => (
              <li key={n.id}>
                {n.label}: {n.note}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      ) : null}

      {alc ? <div className="flex flex-wrap gap-2">{m.attributes.length ? <AlcoholBadge /> : <AlcoholBadge may />}</div> : null}

      {m.listsAllergens || m.options.length || m.marks.length ? (
      <div>
        <TierLabel>{m.listsAllergens ? "Dietary" : "Dietary Options"}</TierLabel>
        {m.diet.length ? (
          <div className="flex flex-wrap gap-2">
            {m.diet.map((d) => (
              <DietChip key={d.id} d={d} />
            ))}
          </div>
        ) : m.options.length || m.marks.length ? null : (
          <p className="text-[15px] text-label-2">No dietary badges for this recipe.</p>
        )}
        {m.marks.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {m.marks.map((k) => (
              <MarkChip key={k.id} k={k} />
            ))}
          </div>
        ) : null}
        {m.options.length ? (
          <ul className="mt-3 space-y-2.5">
            {m.options.map((o) => (
              <li key={o.id}>
                <OptionChip o={o} />
                <p className="mt-1 pl-1 text-[14px] text-label">
                  <span className="font-medium">What changes: </span>
                  {o.note}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      ) : null}

      {!m.listsAllergens && !m.options.length && !m.marks.length && !(seafood || seafoodLabel) ? <p className="text-[15px] text-label-2">{m.drink ? "Drinks carry no menu labels." : "No menu labels set. Add GF, V, VG, GFO, VO, VGO or DFO under Dietary Options."}</p> : null}

      {!m.drink && (seafood || seafoodLabel) ? (
        <div>
          <TierLabel>{BADGE_LABELS.seafoodOrigin}</TierLabel>
          {seafood ? (
            <>
              <SeafoodChip s={seafood} />
              {"state" in seafood ? (
                <p className="mt-1.5 text-[13px] text-label-2">Set the origin on {seafood.missing.slice(0, 4).join(", ")}{seafood.missing.length > 4 ? ` and ${seafood.missing.length - 4} more` : ""}.</p>
              ) : !seafood.required ? (
                <p className="mt-1.5 text-[13px] text-label-2">Not on the menu as seafood, so no letter is needed.</p>
              ) : null}
            </>
          ) : (
            <p className="text-[14px] font-medium text-warn">Marked as seafood, but no seafood ingredient was found.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** The printed-menu legend: dietary option letters and seafood origin letters, from the one central source. */
export function BadgeLegend({ className }: { className?: string }) {
  const line = (l: { key: string; letter: string; text: string }) => (
    <li key={l.key} className="flex gap-2">
      <span className="tnum w-9 shrink-0 font-semibold text-label">{l.letter}</span>
      <span>{l.text}</span>
    </li>
  );
  return (
    <div className={cx("text-[13px] text-label-2", className)} aria-label="Legend">
      <ul className="space-y-0.5">{markLegendLines().map(line)}</ul>
      <ul className="mt-2 space-y-0.5">{dietLegendLines().map(line)}</ul>
      <ul className="mt-2 space-y-0.5">{seafoodLegendLines().map(line)}</ul>
    </div>
  );
}
