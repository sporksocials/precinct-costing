"use client";

import { Check, CircleHelp, Fish, Info, Minus, OctagonAlert, Replace, Truck, TriangleAlert, Wine } from "lucide-react";
import { allergenLabel, ALLERGEN_NOTICE, type AllergenId } from "@/lib/allergens";
import type { BadgeModel, DietBadge, OptionBadge, SeafoodBadge } from "@/lib/allergen-badges";
import { barIngredientName } from "@/lib/bar";
import { BADGE_LABELS, dietLegendLines, LEGEND_INVITATION, seafoodDef, seafoodLegendLines } from "@/lib/diet-legend";
import { cx } from "../ui";
import { KB, toneStyle } from "./palette";
import { CARD, HEADING } from "./parts";

/**
 * Allergen, dietary and seafood badges for the kitchen iPad, read at arm's length across the pass, in glare, often with gloves.
 * They print the shared badge model (lib/allergen-badges.ts), so the kitchen and the costing app always agree.
 *
 * Every badge is a WORD plus a SHAPE or icon, never colour alone (about 1 in 12 men are colour blind). Badge text is 20px or
 * bigger and Contains badges 24px or bigger. Colours live in ./palette.ts and are contrast-tested.
 *
 * Detail block, always in this order and place: Allergens Not Reviewed banner, Contains, Sensitivities, Contains Alcohol,
 * Dietary, Options, Seafood Origin. Tiles carry a compact strip: Not Reviewed first, then Contains, then small markers.
 */

const ICON = "shrink-0";
const TIER = "mb-2 text-[18px] font-medium text-[#9B9890]";

/** names as the kitchen reads them: pack sizes dropped, a long list cut short */
function nameList(names: string[], max = 6): string {
  const clean = names.map(barIngredientName);
  return clean.length > max ? `${clean.slice(0, max).join(", ")} and ${clean.length - max} more` : clean.join(", ");
}

/** the seafood letter only counts on a dish the menu markets as seafood */
function seafoodShown(m: BadgeModel): SeafoodBadge | null {
  return m.seafood && m.seafood.required ? m.seafood : null;
}

/* ------------------------------------------------------------------ single badges */

export function ContainsBadge({ id, big }: { id: AllergenId; big?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-2 rounded-md border-2 font-bold leading-[1.15]", big ? "px-4 py-2 text-[28px]" : "px-3 py-1.5 text-[24px]")} style={toneStyle(KB.contains)}>
      <OctagonAlert aria-hidden className={ICON} size={big ? 30 : 26} strokeWidth={2.75} />
      {allergenLabel(id)}
    </span>
  );
}

export function MayContainBadge({ id, big }: { id: AllergenId; big?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-2 rounded-md border-2 font-semibold leading-[1.15]", big ? "px-4 py-2 text-[26px]" : "px-3 py-1.5 text-[22px]")} style={toneStyle(KB.may, { dashed: true })}>
      <CircleHelp aria-hidden className={ICON} size={big ? 28 : 24} strokeWidth={2.5} />
      {allergenLabel(id)}
      <span className="text-[20px] font-medium">Unconfirmed</span>
    </span>
  );
}

function QuietPill({ icon, children, dashed }: { icon: React.ReactNode; children: React.ReactNode; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border-[1.5px] px-4 py-1.5 text-[20px] font-medium leading-[1.2]" style={toneStyle(KB.quiet, { dashed })}>
      {icon}
      {children}
    </span>
  );
}
export function SensitivityPill({ id, may }: { id: AllergenId; may?: boolean }) {
  return (
    <QuietPill dashed={may} icon={<Info aria-hidden className={ICON} size={22} strokeWidth={2.25} />}>
      {allergenLabel(id)}
      {may ? <span className="text-[18px]">Unconfirmed</span> : null}
    </QuietPill>
  );
}
export function AlcoholPill({ may }: { may?: boolean }) {
  return (
    <QuietPill dashed={may} icon={<Wine aria-hidden className={ICON} size={22} strokeWidth={2.25} />}>
      {BADGE_LABELS.containsAlcohol}
      {may ? <span className="text-[18px]">Unconfirmed</span> : null}
    </QuietPill>
  );
}

function NotReviewedChip() {
  return (
    <span className="inline-flex items-center gap-2 rounded-md border-2 px-3 py-1.5 text-[22px] font-bold leading-[1.15]" style={toneStyle(KB.notReviewed)}>
      <TriangleAlert aria-hidden className={ICON} size={26} strokeWidth={2.75} />
      {BADGE_LABELS.notReviewed}
    </span>
  );
}

function OptionMarker({ o }: { o: OptionBadge }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-xl border-2 px-3 py-1 text-[20px] font-bold leading-[1.2]" style={toneStyle(KB.option)}>
      <Replace aria-hidden className={ICON} size={20} strokeWidth={2.5} />
      {o.letter}
    </span>
  );
}

function SeafoodDisc({ letter, size = 36 }: { letter: string; size?: number }) {
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full text-[22px] font-bold leading-none" style={{ ...toneStyle(KB.seafood), width: size, height: size, borderWidth: 0 }}>
      {letter}
    </span>
  );
}

function SeafoodMarker({ s }: { s: SeafoodBadge }) {
  if ("letter" in s) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border-2 py-1 pl-1.5 pr-3.5 text-[20px] font-bold leading-[1.2]" style={toneStyle(KB.quiet)}>
        <SeafoodDisc letter={s.letter} size={30} />
        <Fish aria-hidden className={ICON} size={20} strokeWidth={2.5} />
        Seafood {s.letter}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full border-2 px-3.5 py-1.5 text-[20px] font-bold leading-[1.2]" style={toneStyle(KB.may, { dashed: true })}>
      <Fish aria-hidden className={ICON} size={20} strokeWidth={2.5} />
      {BADGE_LABELS.originNotConfirmed}
    </span>
  );
}

/* ------------------------------------------------------------------ tile strip */

/** The compact strip on a dish or prep tile. Never blank: it says "No Allergens Listed" only for a fully reviewed recipe with nothing to flag. */
export function BadgeStrip({ m }: { m: BadgeModel }) {
  const seafood = seafoodShown(m);
  const flagged = m.contains.length + m.mayContain.length + m.sensitivities.length + m.sensitivitiesMay.length + m.attributes.length + m.attributesMay.length > 0;
  // a menu-only screen lists just the option letters and the seafood letter: nothing at all when a dish has neither
  if (!m.listsAllergens && !m.notReviewed && !m.options.length && !seafood) return null;
  return (
    <ul className="flex flex-wrap items-center gap-2" aria-label={m.listsAllergens ? "Allergens and dietary" : "Menu labels"}>
      {m.notReviewed ? (
        <li>
          <NotReviewedChip />
        </li>
      ) : null}
      {m.contains.map((id) => (
        <li key={id}>
          <ContainsBadge id={id} />
        </li>
      ))}
      {m.mayContain.map((id) => (
        <li key={`may-${id}`}>
          <MayContainBadge id={id} />
        </li>
      ))}
      {m.sensitivities.map((id) => (
        <li key={`s-${id}`}>
          <SensitivityPill id={id} />
        </li>
      ))}
      {m.sensitivitiesMay.map((id) => (
        <li key={`sm-${id}`}>
          <SensitivityPill id={id} may />
        </li>
      ))}
      {m.attributes.length ? (
        <li>
          <AlcoholPill />
        </li>
      ) : m.attributesMay.length ? (
        <li>
          <AlcoholPill may />
        </li>
      ) : null}
      {m.options.map((o) => (
        <li key={o.id}>
          <OptionMarker o={o} />
        </li>
      ))}
      {seafood ? (
        <li>
          <SeafoodMarker s={seafood} />
        </li>
      ) : null}
      {m.listsAllergens && !m.notReviewed && !flagged ? <li className="text-[20px] text-[#9B9890]">{BADGE_LABELS.noAllergensListed}</li> : null}
    </ul>
  );
}

/* ------------------------------------------------------------------ detail block */

function NotReviewedBanner({ names }: { names: string[] }) {
  return (
    <div role="alert" className="mb-5 flex items-start gap-4 rounded-xl border-2 px-5 py-4" style={toneStyle(KB.notReviewed)}>
      <TriangleAlert aria-hidden className="mt-1 shrink-0" size={36} strokeWidth={2.75} />
      <div className="min-w-0">
        <p className="text-[30px] font-bold leading-tight">{BADGE_LABELS.notReviewed}</p>
        <p className="mt-1.5 text-[22px] font-medium leading-snug">{BADGE_LABELS.notReviewedAction}</p>
        <p className="mt-1.5 text-[20px] leading-snug">{names.length ? `${BADGE_LABELS.notCheckedYet}: ${nameList(names)}. ${BADGE_LABELS.notReviewedStillApply}` : BADGE_LABELS.noIngredients}</p>
      </div>
    </div>
  );
}

function DietSolid({ d }: { d: DietBadge }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-2xl border-2 px-3.5 py-2 text-[21px] font-bold leading-[1.15] sm:px-4 sm:text-[24px]" style={toneStyle(KB.is)}>
      <Check aria-hidden className={ICON} size={26} strokeWidth={3.25} />
      {d.label}
    </span>
  );
}

/** Not Confirmed is one line, not a chip per diet: the words say which ones. */
function DietNotConfirmed({ diets }: { diets: DietBadge[] }) {
  return (
    <p className="inline-flex max-w-full items-start gap-2.5 rounded-xl border-2 border-dashed px-4 py-2.5 text-[20px] leading-snug" style={toneStyle(KB.notConfirmed, { dashed: true })}>
      <Minus aria-hidden className="mt-0.5 shrink-0" size={24} strokeWidth={3} />
      <span className="min-w-0">
        <span className="font-bold">{BADGE_LABELS.notConfirmed}:</span> {diets.map((d) => d.label).join(", ")}
      </span>
    </p>
  );
}

function OptionBlock({ o }: { o: OptionBadge }) {
  return (
    <li className="rounded-xl border-2 px-5 py-4" style={toneStyle(KB.option)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Replace aria-hidden className={ICON} size={28} strokeWidth={2.5} />
        <span className="text-[30px] font-bold leading-none">{o.letter}</span>
        <span className="min-w-0 basis-full text-[22px] font-semibold leading-snug sm:basis-auto">{o.label}</span>
      </div>
      <p className="mt-2 text-[22px] leading-snug text-[#F5F3EE]">
        <span className="font-semibold">{BADGE_LABELS.whatChanges}:</span> {o.note}
      </p>
    </li>
  );
}

function SeafoodBlock({ s }: { s: SeafoodBadge }) {
  if ("letter" in s) {
    const def = seafoodDef(s.letter);
    return (
      <div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="inline-flex items-center gap-3 text-[22px] font-semibold">
            <SeafoodDisc letter={s.letter} size={44} />
            <Fish aria-hidden className={ICON} size={24} strokeWidth={2.25} />
            {def.label}
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border-[1.5px] px-3.5 py-1 text-[20px] font-semibold" style={toneStyle(KB.quiet)}>
            <Truck aria-hidden className={ICON} size={20} strokeWidth={2.25} />
            {BADGE_LABELS.checkDelivery}
          </span>
        </div>
        <p className="mt-2 text-[18px] leading-snug text-[#9B9890]">{BADGE_LABELS.checkDeliveryDetail}</p>
      </div>
    );
  }
  return (
    <div>
      <span className="inline-flex items-center gap-2 rounded-xl border-2 px-4 py-2 text-[24px] font-bold" style={toneStyle(KB.may, { dashed: true })}>
        <Fish aria-hidden className={ICON} size={26} strokeWidth={2.5} />
        {BADGE_LABELS.originNotConfirmed}
      </span>
      <p className="mt-2 text-[18px] leading-snug text-[#F2C46D]">
        {BADGE_LABELS.originNotConfirmedDetail}: {nameList(s.missing, 4)}.
      </p>
    </div>
  );
}

/** The full tiered block at the top of a dish or prep. Tiers with nothing in them are left out; the order never changes. */
export function BadgeBlock({ m }: { m: BadgeModel }) {
  const mainEmpty = m.contains.length === 0 && m.mayContain.length === 0;
  const hasSens = m.sensitivities.length + m.sensitivitiesMay.length > 0;
  const hasAlc = m.attributes.length + m.attributesMay.length > 0;
  const solid = m.diet.filter((d) => d.state === "is");
  const unconfirmed = m.diet.filter((d) => d.state === "not_confirmed");
  const seafood = seafoodShown(m);
  if (!m.listsAllergens && !m.notReviewed && !m.options.length && !seafood) return null;
  return (
    <section className={cx(CARD, "mt-5 px-[22px] py-5")} aria-label={m.listsAllergens ? "Allergens and dietary" : "Menu labels"} data-testid="kitchen-badges">
      <h2 className={cx(HEADING, "mb-3")}>{m.listsAllergens ? "ALLERGENS AND DIETARY" : "MENU LABELS"}</h2>

      {m.notReviewed ? <NotReviewedBanner names={m.notReviewed.unreviewedNames} /> : null}

      {m.listsAllergens ? (
      <div>
        <p className={TIER}>{BADGE_LABELS.contains}</p>
        {mainEmpty ? (
          <p className="text-[24px] font-semibold leading-snug">{m.notReviewed ? BADGE_LABELS.nothingFoundSoFar : BADGE_LABELS.noneListed}</p>
        ) : (
          <div className="flex flex-wrap gap-2.5">
            {m.contains.map((id) => (
              <ContainsBadge key={id} id={id} big />
            ))}
          </div>
        )}
        {m.mayContain.length ? (
          <div className="mt-4">
            <p className={TIER}>{BADGE_LABELS.mayContain}</p>
            <div className="flex flex-wrap gap-2.5">
              {m.mayContain.map((id) => (
                <MayContainBadge key={id} id={id} big />
              ))}
            </div>
          </div>
        ) : null}
        {m.notes.length ? (
          <ul className="mt-3 space-y-1">
            {m.notes.map((n) => (
              <li key={n.id} className="text-[20px] leading-snug text-[#F5F3EE]">
                <span className="font-semibold">{n.label}:</span> {n.note}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      ) : null}

      {hasSens ? (
        <div className="mt-5">
          <p className={TIER}>{BADGE_LABELS.sensitivities}</p>
          <div className="flex flex-wrap gap-2.5">
            {m.sensitivities.map((id) => (
              <SensitivityPill key={id} id={id} />
            ))}
            {m.sensitivitiesMay.map((id) => (
              <SensitivityPill key={`m-${id}`} id={id} may />
            ))}
          </div>
        </div>
      ) : null}

      {hasAlc ? <div className={hasSens ? "mt-4 border-t-[0.5px] border-white/[0.12] pt-4" : "mt-5"}>{m.attributes.length ? <AlcoholPill /> : <AlcoholPill may />}</div> : null}

      {solid.length || unconfirmed.length ? (
        <div className="mt-5">
          <p className={TIER}>{BADGE_LABELS.dietary}</p>
          <div className="flex flex-wrap items-center gap-2.5">
            {solid.map((d) => (
              <DietSolid key={d.id} d={d} />
            ))}
            {unconfirmed.length ? <DietNotConfirmed diets={unconfirmed} /> : null}
          </div>
        </div>
      ) : null}

      {m.options.length ? (
        <div className="mt-5">
          <p className={TIER}>{BADGE_LABELS.options}</p>
          <ul className="space-y-3">
            {m.options.map((o) => (
              <OptionBlock key={o.id} o={o} />
            ))}
          </ul>
        </div>
      ) : null}

      {seafood ? (
        <div className="mt-5">
          <p className={TIER}>{BADGE_LABELS.seafoodOrigin}</p>
          <SeafoodBlock s={seafood} />
        </div>
      ) : null}

      {m.listsAllergens ? <p className="mt-5 text-[16px] leading-snug text-[#9B9890]">{ALLERGEN_NOTICE}</p> : null}
    </section>
  );
}

/* ------------------------------------------------------------------ legend */

/** The legend printed once under the Dishes grid and on a dish: every letter and line comes from lib/diet-legend.ts. */
export function KitchenLegend() {
  const line = (l: { key: string; letter: string; text: string }) => (
    <li key={l.key} className="flex items-baseline gap-3">
      <span className="w-[56px] shrink-0 text-[22px] font-bold leading-snug text-[#EBD9B8]">{l.letter}</span>
      <span className="min-w-0 text-[18px] leading-snug">{l.text}</span>
    </li>
  );
  return (
    <section className={cx(CARD, "mt-6 px-[22px] py-5")} aria-label={BADGE_LABELS.legend} data-testid="kitchen-legend">
      <h2 className={cx(HEADING, "mb-3")}>{BADGE_LABELS.legend.toUpperCase()}</h2>
      <div className="grid gap-x-8 gap-y-4 text-[#D0CCC2] min-[700px]:grid-cols-2">
        <ul className="space-y-2">{dietLegendLines().map(line)}</ul>
        <ul className="space-y-2">{seafoodLegendLines().map(line)}</ul>
      </div>
    </section>
  );
}
