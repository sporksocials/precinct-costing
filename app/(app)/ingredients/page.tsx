"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useStore } from "@/lib/store";
import { costPerBaseFromIndex, priceMovePct } from "@/lib/costing";
import { dateShort, daysAgo, money, movePct, packLabel, unitShort } from "@/lib/format";
import { DataTable } from "@/components/table";
import { indexDoc, search } from "@/lib/search";
import { blankIngredient, IngredientSheet } from "@/components/ingredient-sheet";
import { AddButton, Chips, cx, Empty, PageHeader, Row, SearchField, Segmented } from "@/components/ui";
import { PrepsList } from "@/components/preps-list";
import { useNewRecipe } from "@/components/new-recipe";
import { useVenue } from "@/components/venue";
import { useRouter, useSearchParams } from "next/navigation";
import { catalogueGaps, ingredientsInUse, staleIngredients } from "@/lib/insights";

const PAGE = 100;

type Tab = "ingredients" | "preps";

/** Ingredients and Preps live together: the things you buy, and the batches you make from them. */
export default function IngredientsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const newRecipe = useNewRecipe();
  const { venue } = useVenue();
  const tab: Tab = params.get("type") === "preps" ? "preps" : "ingredients";
  const [adding, setAdding] = useState(false);
  const go = (t: Tab) => {
    if (t === tab) return;
    const p = new URLSearchParams();
    if (t === "preps") {
      p.set("type", "preps");
      if (venue) p.set("venue", venue.slug);
    }
    const q = p.toString();
    router.replace(q ? `/ingredients?${q}` : "/ingredients", { scroll: false });
  };
  return (
    <div>
      <PageHeader
        title="Ingredients"
        trailing={
          tab === "preps" ? (
            <AddButton label="New Prep" onClick={() => newRecipe.open({ venueId: venue?.id ?? null, type: "prep" })} />
          ) : (
            <AddButton label="New Ingredient" onClick={() => setAdding(true)} />
          )
        }
      />
      <Segmented
        ariaLabel="Ingredients or preps"
        className="mb-3 lg:w-80"
        value={tab}
        onChange={go}
        options={[
          { value: "ingredients", label: "Ingredients" },
          { value: "preps", label: "Preps" },
        ]}
      />
      {tab === "preps" ? <PrepsList /> : <IngredientsList adding={adding} setAdding={setAdding} />}
    </div>
  );
}

function IngredientsList({ adding, setAdding }: { adding: boolean; setAdding: (v: boolean) => void }) {
  const store = useStore();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [limit, setLimit] = useState(PAGE);
  const [showUnused, setShowUnused] = useState(false);
  const params = useSearchParams();
  const filter = params.get("filter") as "stale" | "catalogue" | null;
  useEffect(() => setLimit(PAGE), [q, cat, showUnused, filter]);
  useEffect(() => {
    if (filter === "catalogue") store.loadPortalPrices();
  }, [filter, store]);

  const inUse = useMemo(() => ingredientsInUse(store.allLines), [store.allLines]);
  const allActive = useMemo(() => store.ingredients.filter((i) => i.active), [store.ingredients]);
  const unusedCount = useMemo(() => allActive.filter((i) => !inUse.has(i.id)).length, [allActive, inUse]);
  const gaps = useMemo(() => (filter === "catalogue" ? catalogueGaps(store.ingredients, store.portalPrices, store.settings.gst_rate, store.supplierById) : []), [filter, store.ingredients, store.portalPrices, store.settings.gst_rate, store.supplierById]);
  const gapById = useMemo(() => new Map(gaps.map((g) => [g.ingredient.id, g])), [gaps]);
  const active = useMemo(() => {
    if (filter === "stale") return staleIngredients(store.ingredients, inUse);
    if (filter === "catalogue") return gaps.map((g) => g.ingredient);
    return showUnused || q.trim() ? allActive : allActive.filter((i) => inUse.has(i.id));
  }, [filter, store.ingredients, inUse, gaps, showUnused, q, allActive]);
  const cats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of active) if (i.category) counts.set(i.category, (counts.get(i.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [active]);

  const docs = useMemo(
    () => active.map((i) => ({ ...indexDoc({ kind: "ingredient" as const, id: i.id, title: i.name, sub: "", href: "", extra: `${store.supplierById.get(i.supplier_id ?? -1)?.name ?? ""} ${i.supplier_code ?? ""}` }), i })),
    [active, store.supplierById],
  );

  const rows = useMemo(() => {
    let list = cat === "all" ? docs : docs.filter((d) => d.i.category === cat);
    if (q.trim()) return search(list, q, 400).map((h) => h.doc.i);
    list = [...list].sort((a, b) => a.i.name.localeCompare(b.i.name));
    return list.map((d) => d.i);
  }, [docs, cat, q]);

  const gst = store.settings.gst_rate;
  const usedCount = (id: string) => {
    const u = store.usedIn("ingredient", id);
    return u.items.length + u.preps.length;
  };

  return (
    <div>
      {filter ? (
        <div className="mb-3 flex items-center gap-3 rounded-2xl bg-accent-soft px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-accent">{filter === "stale" ? "Not Checked in 90 Days" : "Differs From the Supplier Catalogue"}</span>
            <span className="block text-[13px] text-label-2">
              {filter === "stale" ? "Used in recipes, price not updated in 90 days. Open one and tap Update Price." : "Same product code, different price per unit. Open one to update it."}
            </span>
          </span>
          <button type="button" className="btn-plain !min-h-[36px] shrink-0" onClick={() => router.replace("/ingredients")}>
            Show All
          </button>
        </div>
      ) : null}
      <SearchField value={q} onChange={setQ} placeholder="Search ingredients or suppliers" />
      {filter ? null : <Chips className="mt-3" ariaLabel="Category" value={cat} onChange={setCat} options={[{ value: "all", label: "All" }, ...cats.map((c) => ({ value: c, label: c }))]} />}

      {rows.length === 0 ? (
        <Empty
          title={filter ? "All Caught Up" : "No Results"}
          body={filter === "stale" ? "Every ingredient used in a recipe has a price checked in the last 90 days." : filter === "catalogue" ? "Every linked ingredient matches the supplier catalogue." : q ? `Nothing matches “${q}”.` : "No ingredients in this category."}
        />
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-3 px-4 pb-1.5 pt-5">
            <p className="text-[13px] text-label-2">
              {rows.length} {filter ? "to check" : showUnused || q.trim() ? "ingredients" : "in use"}
            </p>
            {!filter && !q.trim() && unusedCount ? (
              <button type="button" className="text-[13px] font-medium text-accent" onClick={() => setShowUnused((x) => !x)}>
                {showUnused ? "Hide Unused" : `Show Unused (${unusedCount})`}
              </button>
            ) : null}
          </div>
          <div className="hidden lg:block">
            <DataTable
              rows={rows.slice(0, limit)}
              rowKey={(i) => i.id}
              href={(i) => `/ingredients/${i.id}`}
              columns={[
                { key: "name", label: "Ingredient", render: (i) => <span className="font-medium">{i.name}</span>, sort: (i) => i.name },
                { key: "sup", label: "Supplier", render: (i) => <span className="text-label-2">{store.supplierById.get(i.supplier_id ?? -1)?.name ?? "—"}</span>, sort: (i) => store.supplierById.get(i.supplier_id ?? -1)?.name ?? "" },
                { key: "pack", label: "Pack", align: "right", render: (i) => <span className="text-label-2">{packLabel(i.pack_size, i.pack_unit)}</span> },
                { key: "price", label: "Pack Price", align: "right", render: (i) => money(Number(i.pack_price)), sort: (i) => Number(i.pack_price) },
                {
                  key: "unit",
                  label: "Unit Price",
                  align: "right",
                  render: (i) => {
                    const u = costPerBaseFromIndex(store.index, i, gst);
                    return u ? <span className="font-semibold">{`${money(u)}/${unitShort(i.pack_unit)}`}</span> : <span className="text-label-3">No price</span>;
                  },
                  sort: (i) => costPerBaseFromIndex(store.index, i, gst),
                },
                {
                  key: "move",
                  label: "Last Move",
                  align: "right",
                  render: (i) => {
                    const m = (daysAgo(i.last_price_update) ?? 999) <= 30 ? priceMovePct(i.previous_price, i.pack_price) : null;
                    return m ? <span className={m > 0 ? "text-danger" : "text-label-2"}>{m > 0 ? "↑" : "↓"} {movePct(Math.abs(m)).replace("+", "")}</span> : <span className="text-label-3">—</span>;
                  },
                  sort: (i) => ((daysAgo(i.last_price_update) ?? 999) <= 30 ? priceMovePct(i.previous_price, i.pack_price) : null),
                },
                { key: "updated", label: "Updated", align: "right", render: (i) => <span className="text-label-2">{dateShort(i.last_price_update)}</span>, sort: (i) => i.last_price_update ?? "", hideBelow: "xl" },
                { key: "used", label: "Used In", align: "right", render: (i) => <span className="text-label-2">{usedCount(i.id) || "—"}</span>, sort: (i) => usedCount(i.id) },
              ]}
            />
          </div>
          <div className="group-list lg:hidden">
            {rows.slice(0, limit).map((i) => {
              const sup = store.supplierById.get(i.supplier_id ?? -1)?.name;
              const recent = (daysAgo(i.last_price_update) ?? 999) <= 30;
              const move = recent ? priceMovePct(i.previous_price, i.pack_price) : null;
              const unit = costPerBaseFromIndex(store.index, i, gst);
              return (
                <Row
                  key={i.id}
                  href={`/ingredients/${i.id}`}
                  title={i.name}
                  sub={
                    gapById.get(i.id)
                      ? `Catalogue ${money(gapById.get(i.id)!.theirs)}/${unitShort(i.pack_unit)} vs yours ${money(gapById.get(i.id)!.ours)} (${gapById.get(i.id)!.diffPct > 0 ? "+" : ""}${Math.round(gapById.get(i.id)!.diffPct * 100)}%)`
                      : filter === "stale"
                        ? `${sup ?? "No supplier"} · last updated ${i.last_price_update ? dateShort(i.last_price_update) : "never"}`
                        : [sup, `${money(Number(i.pack_price))} per ${packLabel(i.pack_size, i.pack_unit)}`].filter(Boolean).join(" · ")
                  }
                  trailing={
                    <span className="flex flex-col items-end leading-tight">
                      <span className="text-label">{unit ? `${money(unit)}/${unitShort(i.pack_unit)}` : <span className="text-label-3">No price</span>}</span>
                      {move ? <span className={cx("text-[13px]", move > 0 ? "text-danger" : "text-label-2")}>{move > 0 ? "↑" : "↓"} {movePct(Math.abs(move)).replace("+", "")}</span> : null}
                    </span>
                  }
                />
              );
            })}
          </div>
          {rows.length > limit ? (
            <button type="button" className="btn-plain mt-3 w-full" onClick={() => setLimit((l) => l + PAGE * 2)}>
              Show More ({rows.length - limit})
            </button>
          ) : null}
        </>
      )}
      {adding ? (
        <IngredientSheet
          open
          initial={blankIngredient({ name: q.trim() })}
          onClose={() => setAdding(false)}
          onSaved={(ing) => {
            setAdding(false);
            router.push(`/ingredients/${ing.id}`);
          }}
        />
      ) : null}
    </div>
  );
}
