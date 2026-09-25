"use client";

import Link from "next/link";
import React, { useMemo, useState } from "react";
import { Check, Minus, Printer, X } from "lucide-react";
import { useStore } from "@/lib/store";
import {
  ALLERGENS,
  ALLERGEN_NOTICE,
  allergenLabel,
  isFreeFrom,
  matrixRows,
  summarise,
  type AllergenCell,
  type AllergenId,
  type DietTag,
  type MatrixRow,
} from "@/lib/allergens";
import { useVenue, VenueFilter, VENUE_SHORT } from "./venue";
import { useAllergenIndex } from "./allergen-picker";
import { cx, Empty, PageHeader, SearchField } from "./ui";

type DietId = "vegetarian" | "vegan";

/** Screen (dark) and print (light, high contrast) colours for the grid; only the print block changes them. */
const CSS = `
.allergen-print { --mx-red-bg: rgba(255,107,97,.24); --mx-red-fg: #ff9a92; --mx-yel-bg: rgba(255,214,10,.22); --mx-yel-fg: #ffd60a; --mx-grn-bg: rgba(76,213,122,.16); --mx-grn-fg: #4cd57a; --mx-may: #ffb340; --mx-grey-fg: var(--label-3); }
.mx-red { background: var(--mx-red-bg); color: var(--mx-red-fg); }
.mx-yel { background: var(--mx-yel-bg); color: var(--mx-yel-fg); }
.mx-grn { background: var(--mx-grn-bg); color: var(--mx-grn-fg); }
.mx-may { border: 1.5px dashed var(--mx-may); color: var(--mx-may); }
.mx-grey { color: var(--mx-grey-fg); }
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
  .allergen-print thead { display: table-header-group; }
  .allergen-print tr { break-inside: avoid; }
}
`;

const DIETS: { id: DietId; label: string }[] = [
  { id: "vegetarian", label: "Vegetarian" },
  { id: "vegan", label: "Vegan" },
];

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
      <li className="flex items-center gap-1.5"><span className={cx(sw, "mx-grn")}><Check className="h-3 w-3" strokeWidth={3} /></span>Green: free from</li>
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
    <span className={cx(box, "mx-grn")} title={c.chef === "removed" ? `${label}: cleared by the chef${c.was.length ? `, was from ${c.was.join(", ")}` : ""}` : `${label}: free from`} aria-label={`${label}: free from`}>
      <Check aria-hidden className="h-4 w-4" strokeWidth={3} />
      {c.chef === "removed" ? <span aria-hidden className="text-[11px] font-bold">*</span> : null}
    </span>
  );
}

function DietCell({ tag }: { tag: DietTag }) {
  const box = "flex min-h-[44px] w-full items-center justify-center rounded-md";
  const label = `${tag.label}: ${tag.state === "yes" ? "yes" : tag.state === "no" ? "no" : tag.state === "maybe" ? "probably not" : "needs review"}`;
  const because = tag.because.length ? ` (${tag.because.join(", ")})` : "";
  if (tag.state === "yes") return <span className={cx(box, "mx-grn")} title={label} aria-label={label}><Check aria-hidden className="h-4 w-4" strokeWidth={3} /></span>;
  if (tag.state === "no") return <span className={cx(box, "mx-red")} title={label + because} aria-label={label}><X aria-hidden className="h-4 w-4" strokeWidth={3} /></span>;
  if (tag.state === "maybe") return <span className={cx(box, "mx-may text-[13px] font-bold")} title={label + because} aria-label={label}>?</span>;
  return <span className={cx(box, "mx-grey")} title={label} aria-label={label}><Minus aria-hidden className="h-4 w-4" strokeWidth={2.5} /></span>;
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
    return matrixRows(items, idx);
  }, [store.items, idx, venue]);

  const needle = q.trim().toLowerCase();
  const rows = useMemo(
    () =>
      all.filter((r) => {
        if (needle && !`${r.name} ${r.category}`.toLowerCase().includes(needle)) return false;
        for (const id of free) if (!isFreeFrom(r.rollup, id)) return false;
        for (const d of diet) if (r.rollup.diet[d].state !== "yes") return false;
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

  const byCategory: { category: string; rows: MatrixRow[] }[] = [];
  for (const r of rows) {
    const last = byCategory[byCategory.length - 1];
    if (last && last.category === r.category) last.rows.push(r);
    else byCategory.push({ category: r.category, rows: [r] });
  }

  return (
    <div className="allergen-print">
      <style>{CSS}</style>
      <PageHeader
        title="Allergy Matrix"
        subtitle={`${all.length} ${all.length === 1 ? "dish" : "dishes"} · ${reviewedCount} reviewed`}
        trailing={
          <button type="button" className="btn-plain print:hidden" onClick={() => window.print()}>
            <Printer className="h-4 w-4" strokeWidth={2.25} /> Print
          </button>
        }
      />
      <p className="mb-3 text-[15px] font-medium text-label">{ALLERGEN_NOTICE}</p>
      <div className="print:hidden">
        <VenueFilter className="mb-3" stats={false} compact />
        <SearchField value={q} onChange={setQ} placeholder="Search dishes" className="mb-4 lg:max-w-sm" />
        <p className="pb-2 text-[13px] font-medium text-label-2">Free From</p>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" role="group" aria-label="Free from">
          {ALLERGENS.map((a) => (
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
        </div>
        {filtering ? (
          <p className="mt-2 text-[13px] text-label-2">
            Only fully reviewed dishes can be listed as free from anything. {all.length - reviewedCount} {all.length - reviewedCount === 1 ? "dish still needs" : "dishes still need"} review.
          </p>
        ) : null}
      </div>
      <p className="hidden pt-1 text-[13px] print:block">
        {venueName} · printed {today}
        {filterText.length ? ` · showing dishes free from ${filterText.join(", ")}` : ""}
      </p>
      <div className="my-4">
        <Legend />
      </div>

      {rows.length === 0 ? (
        <Empty
          title={filtering ? "No Dishes Match" : "No Dishes Yet"}
          body={filtering ? "No fully reviewed dish is free from all of those. Review more ingredients on the Ingredients page." : "Add menu items and tick their ingredients’ allergens."}
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
            <table className="w-full min-w-[960px] border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 z-[2] min-w-[180px] bg-surface px-3 py-2 text-left text-[13px] font-medium text-label-2">
                    Dish
                  </th>
                  {ALLERGENS.map((a, i) => (
                    <th key={a.id} scope="col" className={cx("h-[104px] w-[46px] min-w-[46px] px-0.5 align-bottom text-[12px] font-medium text-label-2", (i === 12) && "border-l border-[color:var(--separator)]")}>
                      <span className="mx-auto inline-block rotate-180 pb-1 [writing-mode:vertical-rl]">{a.short}</span>
                    </th>
                  ))}
                  {DIETS.map((d, i) => (
                    <th key={d.id} scope="col" className={cx("h-[104px] w-[46px] min-w-[46px] px-0.5 align-bottom text-[12px] font-medium text-label-2", i === 0 && "border-l border-[color:var(--separator)]")}>
                      <span className="mx-auto inline-block rotate-180 pb-1 [writing-mode:vertical-rl]">{d.label}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byCategory.map((g) => (
                  <React.Fragment key={g.category}>
                    <tr>
                      <th colSpan={ALLERGENS.length + 3} scope="colgroup" className="bg-fill px-3 py-1.5 text-left text-[12px] font-semibold text-label-2">
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
                            {!r.rollup.reviewed ? <NeedsReview n={r.rollup.unreviewedCount} /> : null}
                          </span>
                        </th>
                        {ALLERGENS.map((a, i) => (
                          <td key={a.id} className={cx("border-b border-[color:var(--separator)] p-0.5", i === 12 && "border-l")}>
                            <Cell c={r.rollup.cells[a.id]} reviewed={r.rollup.reviewed} label={a.label} />
                          </td>
                        ))}
                        {DIETS.map((d, i) => (
                          <td key={d.id} className={cx("border-b border-[color:var(--separator)] p-0.5", i === 0 && "border-l")}>
                            <DietCell tag={r.rollup.diet[d.id]} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[13px] text-label-2">
            * Cleared by the chef on this dish. Gelato rows cover the flavour mix; cones and toppings are separate. Tap beer rows cover the keg.
          </p>
        </>
      )}
    </div>
  );
}

function DishCard({ r, showVenue }: { r: MatrixRow; showVenue: boolean }) {
  const store = useStore();
  const { contains, may } = summarise(r.rollup);
  const venueName = VENUE_SHORT[store.venueById.get(r.venueId)?.slug ?? ""] ?? "";
  const free = ALLERGENS.filter((a) => isFreeFrom(r.rollup, a.id));
  const chip = "inline-flex items-center rounded-full px-2.5 py-1 text-[13px] font-medium";
  return (
    <Link href={r.href} className="block rounded-2xl bg-surface p-4 active:bg-surface-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[17px] font-semibold leading-tight">{r.name}</p>
          <p className="mt-0.5 text-[13px] text-label-2">{[showVenue ? venueName : null, r.category, r.mixOnly ? "Mix only" : null].filter(Boolean).join(" · ")}</p>
        </div>
        {!r.rollup.reviewed ? <NeedsReview n={0} /> : null}
      </div>
      {!r.rollup.reviewed ? (
        <p className="mt-2 rounded-xl bg-fill px-3 py-2 text-[13px] text-label-2">
          {r.rollup.ingredientCount === 0 ? "No ingredients yet." : `${r.rollup.unreviewedCount} ${r.rollup.unreviewedCount === 1 ? "ingredient" : "ingredients"} not reviewed.`} Nothing is marked free from until every ingredient is reviewed.
        </p>
      ) : null}
      {contains.length ? (
        <div className="mt-3">
          <p className="pb-1.5 text-[12px] font-medium text-label-2">Contains</p>
          <div className="flex flex-wrap gap-1.5">
            {contains.map((id) => {
              const c = r.rollup.cells[id];
              return (
                <span key={id} className={cx(chip, c.note ? "mx-yel" : "mx-red")}>
                  {allergenLabel(id)}
                  {c.note ? `: ${c.note}` : ""}
                </span>
              );
            })}
          </div>
        </div>
      ) : null}
      {may.length ? (
        <div className="mt-3">
          <p className="pb-1.5 text-[12px] font-medium text-label-2">May contain (unconfirmed)</p>
          <div className="flex flex-wrap gap-1.5">
            {may.map((id) => (
              <span key={id} className={cx(chip, "mx-may")}>
                {allergenLabel(id)}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {r.rollup.reviewed && free.length ? (
        <div className="mt-3">
          <p className="pb-1.5 text-[12px] font-medium text-label-2">Free from</p>
          <div className="flex flex-wrap gap-1.5">
            {free.map((a) => (
              <span key={a.id} className={cx(chip, "mx-grn")}>
                {a.label}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-1.5 text-[12px]">
        {[r.rollup.diet.vegetarian, r.rollup.diet.vegan].map((t) => (
          <span key={t.id} className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 font-semibold", t.state === "yes" ? "mx-grn" : t.state === "no" ? "mx-red" : t.state === "maybe" ? "mx-may" : "bg-fill text-label-2")}>
            {t.label}: {t.state === "yes" ? "Yes" : t.state === "no" ? "No" : t.state === "maybe" ? "Probably not" : "Not reviewed"}
          </span>
        ))}
      </div>
    </Link>
  );
}
