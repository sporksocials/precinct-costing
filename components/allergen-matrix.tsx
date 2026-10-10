"use client";

import Link from "next/link";
import React, { useMemo, useState } from "react";
import { Check, Minus, Printer, ShieldCheck, Wine, X } from "lucide-react";
import { useStore } from "@/lib/store";
import {
  ALLERGENS,
  ALLERGEN_NOTICE,
  allergenLabel,
  isFreeFrom,
  matrixRows,
  type AllergenCell,
  type AllergenId,
  type MatrixRow,
} from "@/lib/allergens";
import { badgeModel, DEFAULT_POLICY, isDrinkItem, showsAllergen, type BadgeModel, type DietBadgeId } from "@/lib/allergen-badges";
import { BADGE_LABELS, seafoodDef } from "@/lib/diet-legend";
import { optionText } from "@/lib/diet-options";
import { withOptionSwaps } from "@/lib/allergy-matrix-store";
import { useVenue, VenueFilter, VENUE_SHORT } from "./venue";
import { AllergenTabs } from "./matrix/allergen-tabs";
import { useAllergenIndex } from "./allergen-picker";
import { BadgeLegend, BadgePanel } from "./allergen-badges";
import { cx, Empty, PageHeader, SearchField } from "./ui";

type DietId = DietBadgeId;
type Row = MatrixRow & { model: BadgeModel };

/** Screen (dark) and print (light, high contrast) colours for the grid; only the print block changes them. */
const CSS = `
.allergen-print { --mx-red-bg: rgba(255,107,97,.24); --mx-red-fg: #ff9a92; --mx-yel-bg: rgba(255,214,10,.22); --mx-yel-fg: #ffd60a; --mx-grn-bg: rgba(76,213,122,.16); --mx-grn-fg: #4cd57a; --mx-may: #ffb340; --mx-grey-fg: var(--label-3); }
.mx-red { background: var(--mx-red-bg); color: var(--mx-red-fg); }
.mx-yel { background: var(--mx-yel-bg); color: var(--mx-yel-fg); }
.mx-grn { background: var(--mx-grn-bg); color: var(--mx-grn-fg); }
.mx-may { border: 1.5px dashed var(--mx-may); color: var(--mx-may); }
.mx-grey { color: var(--mx-grey-fg); }
.mx-quiet { border: 1px solid var(--label-3); color: var(--label-2); }
@media print {
  @page { size: A4 landscape; margin: 9mm; }
  html, body { background: #fff !important; color: #000 !important; }
  aside, nav[aria-label="Main"] { display: none !important; }
  div[class*="lg:pl-"] { padding-left: 0 !important; }
  main { max-width: none !important; padding: 0 !important; }
  .allergen-print { --bg: #fff; --surface: #fff; --surface-2: #f2f2f2; --label: #000; --label-2: #222; --label-3: #444; --separator: #888; --danger: #8a0f00; --warn: #7a4a00; --good: #0b5a25;
    --mx-red-bg: #f4a9a2; --mx-red-fg: #5c0a03; --mx-yel-bg: #ffe66d; --mx-yel-fg: #3d3000; --mx-grn-bg: #b6e6c3; --mx-grn-fg: #0b3d1b; --mx-may: #7a4a00; --mx-grey-fg: #333;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; color: #000; }
  .allergen-print table { min-width: 0 !important; font-size: 9px !important; }
  .allergen-print .ab-solid-danger, .allergen-print .ab-solid-good { color: #fff; }
  .allergen-print thead { display: table-header-group; }
  .allergen-print tr { break-inside: avoid; }
}
`;

/** the derived dietary columns: never a "gluten free" claim and never a dairy free one, only what the reviewed ingredients show */
const DIETS_ALL: { id: DietId; label: string }[] = [
  { id: "no_gluten_ingredients", label: BADGE_LABELS.noGlutenIngredients },
  { id: "vegetarian", label: BADGE_LABELS.vegetarian },
  { id: "vegan", label: BADGE_LABELS.vegan },
];
/** Only what the printed menu shows is listed (Troy, 4 Oct 2026): no allergen or computed diet columns, just the option letters and seafood origin. */
const MENU_ONLY_VIEW = DEFAULT_POLICY.allergens.length === 0;
const DIETS = DEFAULT_POLICY.computedDiet ? DIETS_ALL : [];
/** the main allergen columns (required, then chef extras, so Sulphites and Nitrites sit with the rest when the policy lists allergens) */
const MAIN = ALLERGENS.filter((a) => (a.group === "required" || a.group === "extra") && DEFAULT_POLICY.allergens.includes(a.id));
/** alcohol is not an allergen and is not on the menu, so the grid has no column for it */
const ATTR: typeof ALLERGENS = [];
const COLS = MAIN.length + ATTR.length + DIETS.length + 3;

function FilterChip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        "inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[15px] font-medium transition-[background-color,color,transform] duration-200 ease-ios active:scale-[0.97] sm:min-h-[34px] sm:px-3 sm:text-[14px]",
        on ? "bg-accent-fill text-accent-on" : "bg-surface text-label shadow-[inset_0_0_0_0.5px_var(--separator)] hover:bg-surface-2",
      )}
    >
      {on ? <Check aria-hidden className="h-4 w-4" strokeWidth={3} /> : null}
      {label}
    </button>
  );
}

function Legend() {
  const sw = "inline-flex h-5 w-5 items-center justify-center rounded";
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-label-2" aria-label="Legend">
      <li className="flex items-center gap-1.5"><span className={cx(sw, "mx-red")}><X className="h-3 w-3" strokeWidth={3} /></span>Red: contains, cannot eat</li>
      <li className="flex items-center gap-1.5"><span className={cx(sw, "mx-yel text-[11px] font-bold")}>!</span>Yellow: can be made without (see note)</li>
      <li className="flex items-center gap-1.5"><span className={cx(sw, "mx-grn")}><Check className="h-3 w-3" strokeWidth={3} /></span>Green: not in any ingredient</li>
      <li className="flex items-center gap-1.5"><span className={cx(sw, "mx-may text-[11px] font-bold")}>?</span>Dashed: may contain, not confirmed</li>
      <li className="flex items-center gap-1.5"><span className={cx(sw, "mx-grey")}><Minus className="h-3 w-3" strokeWidth={3} /></span>Grey: needs review, nothing claimed</li>
    </ul>
  );
}

/** One grid cell. Green is only ever shown for a fully reviewed dish; an unreviewed dish shows grey instead. */
function Cell({ c, reviewed, label }: { c: AllergenCell; reviewed: boolean; label: string }) {
  const from = c.sources.length ? ` (${c.sources.join(", ")})` : "";
  const box = "flex min-h-[44px] w-full items-center justify-center rounded-md px-1 py-1 text-center leading-tight";
  if (c.state === "contains") {
    if (c.note)
      return (
        <span className={cx(box, "mx-yel flex-col gap-0.5")} title={`${label}: can be made without: ${c.note}${from}`} aria-label={`${label}: can be made without, ${c.note}`}>
          <span className="line-clamp-3 text-[10.5px] font-semibold">{c.note}</span>
        </span>
      );
    return (
      <span className={cx(box, "mx-red")} title={`${label}: contains${from}`} aria-label={`${label}: contains`}>
        <X aria-hidden className="h-4 w-4" strokeWidth={3} />
      </span>
    );
  }
  if (c.state === "may_contain")
    return (
      <span className={cx(box, "mx-may flex-col")} title={`${label}: may contain, not confirmed${from}`} aria-label={`${label}: may contain, not confirmed`}>
        <span className="text-[13px] font-bold">?</span>
        {c.note ? <span className="line-clamp-2 text-[10px]">{c.note}</span> : null}
      </span>
    );
  if (!reviewed)
    return (
      <span className={cx(box, "mx-grey")} title={`${label}: needs review`} aria-label={`${label}: needs review`}>
        <Minus aria-hidden className="h-4 w-4" strokeWidth={2.5} />
      </span>
    );
  return (
    <span className={cx(box, "mx-grn")} title={c.chef === "removed" ? `${label}: cleared by the chef${c.was.length ? `, was from ${c.was.join(", ")}` : ""}` : `${label}: not in any ingredient`} aria-label={`${label}: not in any ingredient`}>
      <Check aria-hidden className="h-4 w-4" strokeWidth={3} />
      {c.chef === "removed" ? <span aria-hidden className="text-[11px] font-bold">*</span> : null}
    </span>
  );
}

/** Contains Alcohol: narrow, outlined and quiet. Never green: a quiet column makes no "free from" claim. */
function QuietCell({ c, reviewed, label }: { c: AllergenCell; reviewed: boolean; label: string }) {
  const box = "flex min-h-[44px] w-full items-center justify-center rounded-md";
  const Icon = Wine;
  const from = c.sources.length ? ` (${c.sources.join(", ")})` : "";
  if (c.state === "contains")
    return (
      <span className={cx(box, "mx-quiet")} title={`${label}: contains alcohol${from}`} aria-label={`${label}: contains alcohol`}>
        <Icon aria-hidden className="h-4 w-4" strokeWidth={2.25} />
      </span>
    );
  if (c.state === "may_contain")
    return (
      <span className={cx(box, "mx-may text-[13px] font-bold")} title={`${label}: may contain, not confirmed${from}`} aria-label={`${label}: may contain, not confirmed`}>
        ?
      </span>
    );
  if (!reviewed)
    return (
      <span className={cx(box, "mx-grey")} title={`${label}: needs review`} aria-label={`${label}: needs review`}>
        <Minus aria-hidden className="h-4 w-4" strokeWidth={2.5} />
      </span>
    );
  return (
    <span className={cx(box, "mx-grey text-[10px]")} title={`${label}: none ticked on any ingredient`} aria-label={`${label}: none ticked`}>
      none
    </span>
  );
}

function DietCell({ m, id }: { m: BadgeModel; id: DietId }) {
  const box = "flex min-h-[44px] w-full items-center justify-center rounded-md";
  const d = m.diet.find((x) => x.id === id);
  const name = DIETS.find((x) => x.id === id)?.label ?? id;
  if (!d) return <span className={cx(box, "mx-red")} title={`${name}: no`} aria-label={`${name}: no`}><X aria-hidden className="h-4 w-4" strokeWidth={3} /></span>;
  if (d.state === "is") return <span className={cx(box, "mx-grn")} title={name} aria-label={name}><Check aria-hidden className="h-4 w-4" strokeWidth={3} /></span>;
  return <span className={cx(box, "mx-grey")} title={`${name}: not confirmed`} aria-label={`${name}: not confirmed`}><Minus aria-hidden className="h-4 w-4" strokeWidth={2.5} /></span>;
}

/** The hand-set marks for the dish (GF, V, VG; VG alone when both are set), a person's own declaration. */
function MarksCell({ m }: { m: BadgeModel }) {
  if (!m.marks.length) return <span className="flex min-h-[44px] items-center justify-center text-label-3" aria-label="No marks">-</span>;
  return (
    <span className="flex min-h-[44px] flex-wrap content-center items-center justify-center gap-x-1 text-[11px] font-bold leading-tight text-good" title={m.marks.map((k) => `${k.letter}: ${k.label}`).join("\n")}>
      {m.marks.map((k) => (
        <span key={k.id}>{k.letter}</span>
      ))}
    </span>
  );
}

/** Dietary option letters for the dish (GFO, VO, VGO, DFO), each with its note in the tooltip. */
function OptionsCell({ m }: { m: BadgeModel }) {
  if (!m.options.length) return <span className="flex min-h-[44px] items-center justify-center text-label-3" aria-label="No options">-</span>;
  return (
    <span className="flex min-h-[44px] flex-wrap content-center items-center justify-center gap-x-1 text-[11px] font-bold leading-tight text-accent" title={m.options.map((o) => `${o.letter}: ${optionText(o.note, o.swap ?? null) || o.label}`).join("\n")}>
      {m.options.map((o) => (
        <span key={o.id}>{o.letter}</span>
      ))}
    </span>
  );
}

/** Seafood origin letter, or ? when an origin is not confirmed. Dishes with no seafood are blank. */
function SeafoodCell({ m }: { m: BadgeModel }) {
  const sf = m.seafood;
  if (!sf) return <span className="flex min-h-[44px] items-center justify-center text-label-3" aria-label="No seafood">-</span>;
  if ("letter" in sf)
    return (
      <span className={cx("mx-auto flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-bold", sf.required ? "bg-accent-fill text-accent-on" : "mx-quiet")} title={`${seafoodDef(sf.letter).label}${sf.required ? "" : " (not marketed as seafood)"}`} aria-label={seafoodDef(sf.letter).label}>
        {sf.letter}
      </span>
    );
  return (
    <span className="mx-may mx-auto flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-bold" title={`${BADGE_LABELS.originNotConfirmed}: ${sf.missing.join(", ")}`} aria-label={BADGE_LABELS.originNotConfirmed}>
      ?
    </span>
  );
}

function NeedsReview({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center rounded-full bg-fill-2 px-2 py-0.5 text-[12px] font-semibold text-label-2">
      Needs review{n > 0 ? ` · ${n} not reviewed` : ""}
    </span>
  );
}

export function AllergenMatrix() {
  const store = useStore();
  const idx = useAllergenIndex();
  const { venue } = useVenue();
  const [q, setQ] = useState("");
  const [free, setFree] = useState<Set<AllergenId>>(new Set());
  const [diet, setDiet] = useState<Set<DietId>>(new Set());

  const all = useMemo(() => {
    const items = store.items.filter((i) => i.active && (!venue || i.venue_id === venue.id));
    return matrixRows(items, idx).map((row): Row => ({ ...row, model: withOptionSwaps(badgeModel(row.rollup, row.item), row.item, idx) }));
  }, [store.items, idx, venue]);

  const needle = q.trim().toLowerCase();
  const rows = useMemo(
    () =>
      all.filter((r) => {
        if (needle && !`${r.name} ${r.category}`.toLowerCase().includes(needle)) return false;
        for (const id of free) if (!showsAllergen(r.item, id) || !isFreeFrom(r.rollup, id)) return false;
        for (const d of diet) if (r.model.diet.find((x) => x.id === d)?.state !== "is") return false;
        return true;
      }),
    [all, needle, free, diet],
  );
  const reviewedCount = all.filter((r) => r.rollup.reviewed).length;
  const filtering = free.size > 0 || diet.size > 0;
  const toggle = <T,>(set: Set<T>, v: T, put: (s: Set<T>) => void) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    put(n);
  };
  const venueName = venue ? VENUE_SHORT[venue.slug] ?? venue.name : "All venues";
  const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "Australia/Brisbane" });
  const filterText = [...[...free].map((id) => allergenLabel(id)), ...[...diet].map((d) => DIETS.find((x) => x.id === d)!.label)];

  const byCategory: { category: string; rows: Row[] }[] = [];
  for (const r of rows) {
    const last = byCategory[byCategory.length - 1];
    if (last && last.category === r.category) last.rows.push(r);
    else byCategory.push({ category: r.category, rows: [r] });
  }

  return (
    <div className="allergen-print">
      <style>{CSS}</style>
      <PageHeader
        title={MENU_ONLY_VIEW ? "Allergens" : "Allergy Matrix"}
        subtitle={MENU_ONLY_VIEW ? `Menu labels · ${all.length} ${all.length === 1 ? "dish" : "dishes"}` : `${all.length} ${all.length === 1 ? "dish" : "dishes"} · ${reviewedCount} reviewed`}
        trailing={
          <button type="button" className="btn-plain print:hidden" onClick={() => window.print()}>
            <Printer className="h-4 w-4" strokeWidth={2.25} /> Print
          </button>
        }
      />
      {MENU_ONLY_VIEW ? <p className="mb-3 text-[15px] text-label-2">The labels on the printed menu: GF, V, VG, GFO, VO, VGO, DFO and the seafood origin letters. Set them on each dish, under Menu Labels.</p> : <p className="mb-3 text-[15px] font-medium text-label">{ALLERGEN_NOTICE}</p>}
      <div className="print:hidden">
        {MENU_ONLY_VIEW ? <AllergenTabs current="labels" venueSlug={venue?.slug} /> : null}
        <VenueFilter className="mb-3" stats={false} compact />
        <SearchField value={q} onChange={setQ} placeholder="Search dishes" className="mb-4 lg:max-w-sm" />
        {MENU_ONLY_VIEW ? null : <p className="pb-2 text-[13px] font-medium text-label-2">Not In Any Ingredient</p>}
        {MENU_ONLY_VIEW ? null : <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" role="group" aria-label="Not in any ingredient">
          {ALLERGENS.filter((a) => MAIN.some((m) => m.id === a.id)).map((a) => (
            <FilterChip key={a.id} label={a.label} on={free.has(a.id)} onClick={() => toggle(free, a.id, setFree)} />
          ))}
          {DIETS.map((d) => (
            <FilterChip key={d.id} label={d.label} on={diet.has(d.id)} onClick={() => toggle(diet, d.id, setDiet)} />
          ))}
          {filtering ? (
            <button type="button" className="btn-text" onClick={() => { setFree(new Set()); setDiet(new Set()); }}>
              Clear
            </button>
          ) : null}
        </div>}
        {filtering ? (
          <p className="mt-2 text-[13px] text-label-2">
            Only fully reviewed dishes can be listed as having none of something. {all.length - reviewedCount} {all.length - reviewedCount === 1 ? "dish still needs" : "dishes still need"} review.
          </p>
        ) : null}
      </div>
      <p className="hidden pt-1 text-[13px] print:block">
        {venueName} · printed {today}
        {filterText.length ? ` · showing dishes with no ${filterText.join(", ")} in any ingredient` : ""}
      </p>
      {MENU_ONLY_VIEW ? <div className="my-4" /> : (
        <div className="my-4">
          <Legend />
        </div>
      )}

      {rows.length === 0 ? (
        <Empty
          title={filtering ? "No Dishes Match" : "No Dishes Yet"}
          body={filtering ? "No fully reviewed dish has none of all of those. Review more ingredients on the Ingredients page." : "Add menu items and tick their ingredients’ allergens."}
        />
      ) : (
        <>
          {/* phone: a card per dish */}
          <div className="space-y-3 lg:hidden print:hidden">
            {rows.map((r) => (
              <DishCard key={r.key} r={r} showVenue={!venue} />
            ))}
          </div>

          {/* desktop (and print): the full grid */}
          <div className="hidden overflow-x-auto rounded-2xl bg-surface lg:block print:block print:overflow-visible print:rounded-none">
            <table className="w-full min-w-[900px] border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 z-[2] min-w-[150px] bg-surface px-3 py-2 text-left text-[13px] font-medium text-label-2">
                    Dish
                  </th>
                  {MAIN.map((a) => (
                    <th key={a.id} scope="col" className="h-[132px] w-[36px] min-w-[36px] px-0.5 align-bottom text-[12px] font-medium text-label-2">
                      <span className="mx-auto inline-block rotate-180 pb-1 [writing-mode:vertical-rl]">{a.short}</span>
                    </th>
                  ))}
                  {ATTR.map((a, i) => (
                    <th key={a.id} scope="col" className={cx("h-[132px] w-[32px] min-w-[32px] px-0.5 align-bottom text-[12px] font-medium text-label-2", i === 0 && "border-l border-[color:var(--separator)]")}>
                      <span className="mx-auto inline-block rotate-180 pb-1 [writing-mode:vertical-rl]">{a.short}</span>
                    </th>
                  ))}
                  {DIETS.map((d, i) => (
                    <th key={d.id} scope="col" className={cx("h-[132px] w-[36px] min-w-[36px] px-0.5 align-bottom text-[12px] font-medium text-label-2", i === 0 && "border-l border-[color:var(--separator)]")}>
                      <span className="mx-auto inline-block rotate-180 pb-1 [writing-mode:vertical-rl]">{d.label}</span>
                    </th>
                  ))}
                  <th scope="col" className="h-[132px] w-[40px] min-w-[40px] border-l border-[color:var(--separator)] px-0.5 align-bottom text-[12px] font-medium text-label-2">
                    <span className="mx-auto inline-block rotate-180 pb-1 [writing-mode:vertical-rl]">Marks</span>
                  </th>
                  <th scope="col" className="h-[132px] w-[56px] min-w-[56px] border-l border-[color:var(--separator)] px-0.5 align-bottom text-[12px] font-medium text-label-2">
                    <span className="mx-auto inline-block rotate-180 pb-1 [writing-mode:vertical-rl]">Options</span>
                  </th>
                  <th scope="col" className="h-[132px] w-[40px] min-w-[40px] px-0.5 align-bottom text-[12px] font-medium text-label-2">
                    <span className="mx-auto inline-block rotate-180 pb-1 [writing-mode:vertical-rl]">Seafood Origin</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {byCategory.map((g) => (
                  <React.Fragment key={g.category}>
                    <tr>
                      <th colSpan={COLS + 1} scope="colgroup" className="bg-fill px-3 py-1.5 text-left text-[12px] font-semibold text-label-2">
                        {g.category}
                      </th>
                    </tr>
                    {g.rows.map((r) => (
                      <tr key={r.key}>
                        <th scope="row" className="sticky left-0 z-[1] border-b border-[color:var(--separator)] bg-surface px-3 py-1.5 text-left align-middle font-normal">
                          <Link href={r.href} className="block text-[14px] font-medium leading-tight hover:underline print:no-underline">
                            {r.name}
                          </Link>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-label-2">
                            {!venue ? <span>{VENUE_SHORT[store.venueById.get(r.venueId)?.slug ?? ""] ?? ""}</span> : null}
                            {r.mixOnly ? <span>Mix only</span> : null}
                            {!MENU_ONLY_VIEW && !r.rollup.reviewed ? <NeedsReview n={r.rollup.unreviewedCount} /> : null}
                          </span>
                        </th>
                        {MAIN.map((a) => (
                          <td key={a.id} className="border-b border-[color:var(--separator)] p-0.5">
                            {showsAllergen(r.item, a.id) ? <Cell c={r.rollup.cells[a.id]} reviewed={r.rollup.reviewed} label={a.label} /> : null}
                          </td>
                        ))}
                        {ATTR.map((a, i) => (
                          <td key={a.id} className={cx("border-b border-[color:var(--separator)] p-0.5", i === 0 && "border-l")}>
                            {isDrinkItem(r.item) ? null : <QuietCell c={r.rollup.cells[a.id]} reviewed={r.rollup.reviewed} label={BADGE_LABELS.containsAlcohol} />}
                          </td>
                        ))}
                        {DIETS.map((d, i) => (
                          <td key={d.id} className={cx("border-b border-[color:var(--separator)] p-0.5", i === 0 && "border-l")}>
                            {isDrinkItem(r.item) ? null : <DietCell m={r.model} id={d.id} />}
                          </td>
                        ))}
                        <td className="border-b border-l border-[color:var(--separator)] p-0.5">
                          {isDrinkItem(r.item) ? null : <MarksCell m={r.model} />}
                        </td>
                        <td className="border-b border-l border-[color:var(--separator)] p-0.5">
                          {isDrinkItem(r.item) ? null : <OptionsCell m={r.model} />}
                        </td>
                        <td className="border-b border-[color:var(--separator)] p-0.5">
                          {isDrinkItem(r.item) ? null : <SeafoodCell m={r.model} />}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[13px] text-label-2">
            * Cleared by the chef on this dish. Gelato rows cover the flavour mix; cones and toppings are separate. Tap beer rows cover the keg. The dietary columns are worked out from reviewed ingredients. GF, V and VG are set by hand on the dish. The app never works out gluten free or dairy free.
          </p>
          <BadgeLegend className="mt-3 print:mt-2" />
        </>
      )}
    </div>
  );
}

function DishCard({ r, showVenue }: { r: Row; showVenue: boolean }) {
  const store = useStore();
  const venueName = VENUE_SHORT[store.venueById.get(r.venueId)?.slug ?? ""] ?? "";
  return (
    <Link href={r.href} className="block rounded-2xl bg-surface p-4 active:bg-surface-2">
      <div className="min-w-0">
        <p className="text-[17px] font-semibold leading-tight">{r.name}</p>
        <p className="mt-0.5 text-[13px] text-label-2">{[showVenue ? venueName : null, r.category, r.mixOnly ? "Mix only" : null].filter(Boolean).join(" · ")}</p>
      </div>
      <BadgePanel model={r.model} seafoodLabel={!!r.item?.seafood_label} className="mt-3" />
    </Link>
  );
}
