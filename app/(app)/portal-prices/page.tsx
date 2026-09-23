"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { useStore } from "@/lib/store";
import { parsePackFromUom } from "@/lib/costing";
import { dateShort, money, packLabel, unitShort } from "@/lib/format";
import { titleCase } from "@/lib/parse-qty";
import { indexDoc, search } from "@/lib/search";
import type { PortalPrice } from "@/lib/types";
import { draftFromPortal, IngredientSheet } from "@/components/ingredient-sheet";
import { Banner, Chips, Empty, ListSkeleton, PageHeader, Row, SearchField } from "@/components/ui";

const PAGE = 100;

export default function SupplierPricesPage() {
  const store = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [supplier, setSupplier] = useState("all");
  const [limit, setLimit] = useState(PAGE);
  const [adding, setAdding] = useState<PortalPrice | null>(null);

  useEffect(() => {
    store.loadPortalPrices();
  }, [store]);
  useEffect(() => setLimit(PAGE), [q, supplier]);

  const rows = store.portalPrices;
  const suppliers = useMemo(() => [...new Set((rows ?? []).map((r) => r.supplier))].sort(), [rows]);
  const known = useMemo(() => {
    const s = new Set<string>();
    for (const i of store.ingredients) if (i.supplier_code) s.add(i.supplier_code.toLowerCase());
    return s;
  }, [store.ingredients]);

  const docs = useMemo(() => (rows ?? []).map((r) => ({ ...indexDoc({ kind: "portal" as const, id: String(r.id), title: titleCase(r.description ?? ""), sub: "", href: "", extra: `${r.supplier} ${r.product_code ?? ""} ${r.category ?? ""}` }), r })), [rows]);
  const filtered = useMemo(() => {
    const list = supplier === "all" ? docs : docs.filter((d) => d.r.supplier === supplier);
    if (q.trim()) return search(list, q, 500).map((h) => h.doc);
    return [...list].sort((a, b) => a.title.localeCompare(b.title));
  }, [docs, supplier, q]);

  const captured = rows?.[0]?.captured_at;

  return (
    <div>
      <PageHeader title="Supplier prices" subtitle={captured ? `Latest portal prices · ${dateShort(captured)}` : undefined} />
      <SearchField value={q} onChange={setQ} placeholder="Search the catalogue" />
      {suppliers.length > 1 ? <Chips className="mt-3" ariaLabel="Supplier" value={supplier} onChange={setSupplier} options={[{ value: "all", label: "All" }, ...suppliers.map((s) => ({ value: s, label: s }))]} /> : null}
      {store.portalError ? <Banner>{store.portalError}</Banner> : null}
      {rows === null && !store.portalError ? <ListSkeleton rows={8} /> : null}
      {rows && filtered.length === 0 ? <Empty title="No results" body={q ? `Nothing matches “${q}”.` : "No catalogue prices yet."} /> : null}
      {filtered.length ? (
        <>
          <p className="px-4 pb-1.5 pt-5 text-[13px] text-label-2">{filtered.length} products</p>
          <div className="group-list">
            {filtered.slice(0, limit).map(({ r, title }) => {
              const pack = parsePackFromUom(r.uom);
              const isKnown = !!r.product_code && known.has(r.product_code.toLowerCase());
              const per = pack && pack.pack_size > 0 && r.price ? `${money(Number(r.price) / pack.pack_size)}/${unitShort(pack.pack_unit)}` : null;
              return (
                <Row
                  key={r.id}
                  onClick={isKnown ? undefined : () => setAdding(r)}
                  title={title}
                  sub={[r.supplier, pack ? packLabel(pack.pack_size, pack.pack_unit) : r.uom, r.in_stock === false ? "Out of stock" : null].filter(Boolean).join(" · ")}
                  trailing={
                    <span className="flex items-center gap-2">
                      <span className="flex flex-col items-end leading-tight">
                        <span className="text-label">{money(r.price)}</span>
                        {per ? <span className="text-[13px]">{per}</span> : null}
                      </span>
                      {isKnown ? <Check className="h-4 w-4 text-label-3" aria-label="Already an ingredient" /> : <span className="text-[15px] font-semibold text-accent">Add</span>}
                    </span>
                  }
                />
              );
            })}
          </div>
          {filtered.length > limit ? (
            <button type="button" className="btn-plain mt-3 w-full" onClick={() => setLimit((l) => l + PAGE * 2)}>
              Show more ({filtered.length - limit})
            </button>
          ) : null}
        </>
      ) : null}
      {adding ? (
        <IngredientSheet
          open
          title="Add as ingredient"
          note="Prefilled from the supplier catalogue. Check the pack size."
          initial={draftFromPortal(adding, store.suppliers, store.settings.gst_rate)}
          onClose={() => setAdding(null)}
          onSaved={(ing) => {
            setAdding(null);
            router.push(`/ingredients/${ing.id}`);
          }}
        />
      ) : null}
    </div>
  );
}
