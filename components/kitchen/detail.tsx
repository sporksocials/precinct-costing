"use client";

import { useMemo, useState } from "react";
import { SCALES, groupLabel, kitchenPhotoSrc, qtyParts, scaleLabel, scaleQty, yieldText, type KitchenDish, type KitchenPrep } from "@/lib/kitchen";
import { componentsOf, dishAllergens, prepAllergens, usedIn, type Component, type KitchenModel } from "@/lib/kitchen-model";
import { cx } from "../ui";
import { AllergenCard, BackBar, CARD, Chevron, HEADING, PhotoColumn, ROW, StaleBanner, Steps } from "./parts";

/** One component row: the amount (grams, ml or a count) on the left, the name on the right with its note small after it. A prep is a button into that prep. */
function ComponentRow({ c, scale, onOpenPrep }: { c: Component; scale: number; onOpenPrep: (id: string) => void }) {
  const q = qtyParts(scaleQty(c.qty, scale), c.unit);
  const amount = (
    <div className="w-[96px] shrink-0 text-[#D9C3A0] sm:w-[112px]">
      <span className="text-[28px] font-bold leading-[1.1]">{q.value}</span>
      {q.unit ? <span className="ml-[3px] text-[20px] font-medium">{q.unit}</span> : null}
    </div>
  );
  const label = (
    <div className="min-w-0 flex-1">
      <span className="text-[24px] leading-[1.25]">{c.name}</span>
      {c.note ? <span className="ml-2 text-[18px] leading-snug text-[#9B9890]">{c.note}</span> : null}
    </div>
  );
  if (c.kind !== "prep") {
    return (
      <li className={cx(ROW, "flex min-h-[64px] items-center gap-[14px] py-[12px]")}>
        {amount}
        {label}
      </li>
    );
  }
  return (
    <li className={ROW}>
      <button type="button" onClick={() => onOpenPrep(c.id)} className="-mx-3 flex min-h-[64px] w-[calc(100%+24px)] items-center gap-[14px] rounded-xl px-3 py-[12px] text-left active:bg-[#232327]">
        {amount}
        {label}
        <span className="shrink-0 rounded-full border-[0.5px] border-[color:var(--bar-accent)] px-3 py-[3px] text-[16px] font-semibold text-[color:var(--bar-text)]">Prep</span>
        <Chevron className="shrink-0 text-[#8E8C85]" />
      </button>
    </li>
  );
}

function Components({ items, scale = 1, onOpenPrep }: { items: Component[]; scale?: number; onOpenPrep: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <section className={cx(CARD, "mt-5 px-5 py-[18px]")}>
      <h2 className={cx(HEADING, "mb-2")}>COMPONENTS</h2>
      <ul>
        {items.map((c, i) => (
          <ComponentRow key={`${c.kind}:${c.id}:${i}`} c={c} scale={scale} onOpenPrep={onOpenPrep} />
        ))}
      </ul>
    </section>
  );
}

interface DetailProps {
  model: KitchenModel;
  backLabel: string;
  onBack: () => void;
  onOpenPrep: (id: string) => void;
  onOpenDish: (id: string) => void;
  syncedAt: string | null;
  now: number;
}

/** One dish, full screen: what goes in it, how it's assembled and plated, and what it contains. */
export function DishDetail({ model, dish, backLabel, onBack, onOpenPrep, syncedAt, now }: DetailProps & { dish: KitchenDish }) {
  const components = useMemo(() => componentsOf(model, "item", dish.id), [model, dish.id]);
  const allergens = useMemo(() => dishAllergens(model, dish.id), [model, dish.id]);
  const photo = kitchenPhotoSrc(dish.photo);
  return (
    <div className="flex w-full flex-col">
      <BackBar label={backLabel} onBack={onBack} />
      <StaleBanner syncedAt={syncedAt} now={now} />

      <div className="mx-auto w-full max-w-[1000px] px-6 pb-10 pt-7">
        <div className="flex flex-col items-start gap-5 sm:flex-row">
          <div className="min-w-0 flex-1 self-stretch">
            <h1 className="font-display text-[52px] leading-none tracking-[0.5px]">{dish.name}</h1>
            <p className="mt-[10px] text-[18px] font-medium text-[#D9C3A0]">
              {groupLabel(dish.section)}
              {dish.portions > 1 ? ` · Quantities make ${dish.portions} portions` : ""}
            </p>
            <Components items={components} onOpenPrep={onOpenPrep} />
          </div>
          <PhotoColumn src={photo} />
        </div>

        <Steps title="ASSEMBLY" steps={dish.method} circle="bg-[color:var(--bar-accent)] text-[color:var(--bar-on)]" />
        <Steps title="PLATING" steps={dish.plating} circle="bg-[#D9C3A0] text-[#20191A]" />
        <AllergenCard a={allergens} />
      </div>
    </div>
  );
}

/** One prep, full screen: scale the batch ×½ to ×3 (display only), then components, method, storage, and where it's used. */
export function PrepDetail({ model, prep, backLabel, onBack, onOpenPrep, onOpenDish, syncedAt, now }: DetailProps & { prep: KitchenPrep }) {
  // a new prep starts at ×1 again: the station renders this with key={prep.id}
  const [scale, setScale] = useState<number>(1);
  const components = useMemo(() => componentsOf(model, "prep", prep.id), [model, prep.id]);
  const allergens = useMemo(() => prepAllergens(model, prep.id), [model, prep.id]);
  const dishes = useMemo(() => usedIn(model, prep.id), [model, prep.id]);
  const makes = yieldText(prep.yieldQty, prep.yieldUnit, scale);
  return (
    <div className="flex w-full flex-col">
      <BackBar label={backLabel} onBack={onBack} />
      <StaleBanner syncedAt={syncedAt} now={now} />

      <div className="mx-auto w-full max-w-[1000px] px-6 pb-10 pt-7">
        <h1 className="font-display text-[52px] leading-none tracking-[0.5px]">{prep.name}</h1>
        <p className="mt-[10px] text-[18px] font-medium text-[#D9C3A0]">{prep.prepType ? `${prep.prepType} Prep` : "Prep"}</p>

        <section className={cx(CARD, "mt-5 px-5 py-[18px]")}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className={cx(HEADING, "mb-1")}>BATCH</h2>
              <p className="text-[32px] font-bold leading-[1.15] text-[#D9C3A0]">{makes || "Yield not set"}</p>
            </div>
            <div role="group" aria-label="Scale" className="grid grid-cols-4 gap-2 sm:w-[340px]">
              {SCALES.map((k) => {
                const on = k === scale;
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={on}
                    aria-label={`Scale ${scaleLabel(k)}`}
                    onClick={() => setScale(k)}
                    className={cx(
                      "min-h-[64px] rounded-[14px] text-[28px] font-semibold",
                      on ? "bg-[color:var(--bar-accent)] text-[color:var(--bar-on)]" : "border-[0.5px] border-white/[0.18] bg-transparent text-[#F5F3EE] active:bg-[#232327]",
                    )}
                  >
                    {scaleLabel(k)}
                  </button>
                );
              })}
            </div>
          </div>
          {scale !== 1 ? <p className="mt-3 text-[16px] leading-snug text-[#9B9890]">Amounts and yield are scaled {scaleLabel(scale)}. Method steps and storage are unchanged.</p> : null}
        </section>

        <Components items={components} scale={scale} onOpenPrep={onOpenPrep} />
        <Steps title="METHOD" steps={prep.method} circle="bg-[color:var(--bar-accent)] text-[color:var(--bar-on)]" />

        {prep.storage ? (
          <section className={cx(CARD, "mt-4 px-[22px] py-5")}>
            <h2 className={cx(HEADING, "mb-2")}>STORAGE</h2>
            <p className="text-[24px] font-medium leading-[1.3]">{prep.storage}</p>
          </section>
        ) : null}

        {dishes.length ? (
          <section className={cx(CARD, "mt-4 px-5 py-[18px]")}>
            <h2 className={cx(HEADING, "mb-2")}>USED IN</h2>
            <ul>
              {dishes.map((d) => (
                <li key={d.id} className={ROW}>
                  <button type="button" onClick={() => onOpenDish(d.id)} className="-mx-3 flex min-h-[64px] w-[calc(100%+24px)] items-center gap-[14px] rounded-xl px-3 py-[12px] text-left active:bg-[#232327]">
                    <span className="min-w-0 flex-1">
                      <span className="text-[24px] leading-[1.25]">{d.name}</span>
                      <span className="ml-2 text-[18px] text-[#9B9890]">{groupLabel(d.section)}</span>
                    </span>
                    <Chevron className="shrink-0 text-[#8E8C85]" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <AllergenCard a={allergens} />
      </div>
    </div>
  );
}
