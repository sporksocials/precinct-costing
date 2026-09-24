"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useStore } from "@/lib/store";
import { ingredientCostPerBase, priceMovePct } from "@/lib/costing";
import { dateShort, daysAgo, money, movePct, packLabel, unitShort } from "@/lib/format";
import { DataTable } from "@/components/table";
import { indexDoc, search } from "@/lib/search";
import { blankIngredient, IngredientSheet } from "@/components/ingredient-sheet";
import { Chips, cx, Empty, PageHeader, Row, SearchField } from "@/components/ui";
import { useRouter } from "next/navigation";

const PAGE = 100;

export default function IngredientsPage() {
  const store = useStore();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [limit, setLimit] = useState(PAGE);
  const [adding, setAdding] = useState(false);
  useEffect(() => setLimit(PAGE), [q, cat]);

  const active = useMemo(() => store.ingredients.filter((i) => i.active), [store.ingredients]);
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
      <PageHeader
        title="Ingredients"
        trailing={
          <button type="button" className="btn-tinted" onClick={() => setAdding(true)} aria-label="Add ingredient">
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            <span className="hidden sm:inline">Add</span>
          </button>
        }
      />
      <SearchField value={q} onChange={setQ} placeholder="Search ingredients or suppliers" />
      <Chips className="mt-3" ariaLabel="Category" value={cat} onChange={setCat} options={[{ value: "all", label: "All" }, ...cats.map((c) => ({ value: c, label: c }))]} />

      {rows.length === 0 ? (
        <Empty title="No results" body={q ? `Nothing matches “${q}”.` : "No ingredients in this category."} />
      ) : (
        <>
          <p className="px-4 pb-1.5 pt-5 text-[13px] text-label-2">{rows.length} ingredients</p>
          <div className="hidden lg:block">
            <DataTable
              rows={rows.slice(0, limit)}
              rowKey={(i) => i.id}
              href={(i) => `/ingredients/${i.id}`}
              columns={[
                { key: "name", label: "Ingredient", render: (i) => <span className="font-medium">{i.name}</span>, sort: (i) => i.name },
                { key: "sup", label: "Supplier", render: (i) => <span className="text-label-2">{store.supplierById.get(i.supplier_id ?? -1)?.name ?? "—"}</span>, sort: (i) => store.supplierById.get(i.supplier_id ?? -1)?.name ?? "" },
                { key: "pack", label: "Pack", align: "right", render: (i) => <span className="text-label-2">{packLabel(i.pack_size, i.pack_unit)}</span> },
                { key: "price", label: "Pack price", align: "right", render: (i) => money(Number(i.pack_price)), sort: (i) => Number(i.pack_price) },
                {
                  key: "unit",
                  label: "Unit price",
                  align: "right",
                  render: (i) => {
                    const u = ingredientCostPerBase(i, gst);
                    return u ? <span className="font-semibold">{`${money(u)}/${unitShort(i.pack_unit)}`}</span> : <span className="text-label-3">No price</span>;
                  },
                  sort: (i) => ingredientCostPerBase(i, gst),
                },
                {
                  key: "move",
                  label: "Last move",
                  align: "right",
                  render: (i) => {
                    const m = (daysAgo(i.last_price_update) ?? 999) <= 30 ? priceMovePct(i.previous_price, i.pack_price) : null;
                    return m ? <span className={m > 0 ? "text-danger" : "text-label-2"}>{m > 0 ? "↑" : "↓"} {movePct(Math.abs(m)).replace("+", "")}</span> : <span className="text-label-3">—</span>;
                  },
                  sort: (i) => ((daysAgo(i.last_price_update) ?? 999) <= 30 ? priceMovePct(i.previous_price, i.pack_price) : null),
                },
                { key: "updated", label: "Updated", align: "right", render: (i) => <span className="text-label-2">{dateShort(i.last_price_update)}</span>, sort: (i) => i.last_price_update ?? "", hideBelow: "xl" },
                { key: "used", label: "Used in", align: "right", render: (i) => <span className="text-label-2">{usedCount(i.id) || "—"}</span>, sort: (i) => usedCount(i.id) },
              ]}
            />
          </div>
          <div className="group-list lg:hidden">
            {rows.slice(0, limit).map((i) => {
              const sup = store.supplierById.get(i.supplier_id ?? -1)?.name;
              const recent = (daysAgo(i.last_price_update) ?? 999) <= 30;
              const move = recent ? priceMovePct(i.previous_price, i.pack_price) : null;
              const unit = ingredientCostPerBase(i, gst);
              return (
                <Row
                  key={i.id}
                  href={`/ingredients/${i.id}`}
                  title={i.name}
                  sub={[sup, `${money(Number(i.pack_price))} per ${packLabel(i.pack_size, i.pack_unit)}`].filter(Boolean).join(" · ")}
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
              Show more ({rows.length - limit})
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
