"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { ingredientCostPerBase } from "@/lib/costing";
import { money } from "@/lib/format";
import { indexDoc, search } from "@/lib/search";
import { Row, SearchField, Sheet } from "./ui";

/** Pick the keg a beer pours from: ingredients priced per litre, best matches first. */
export function KegPicker({ open, onClose, onPick, initialQuery = "" }: { open: boolean; onClose: () => void; onPick: (ingredientId: string) => void; initialQuery?: string }) {
  const store = useStore();
  const [q, setQ] = useState(initialQuery);
  const docs = useMemo(
    () =>
      store.ingredients
        .filter((i) => i.active && i.pack_unit === "L")
        .map((i) => ({ ...indexDoc({ kind: "ingredient" as const, id: i.id, title: i.name, sub: "", href: "", extra: store.supplierById.get(i.supplier_id ?? -1)?.name ?? "" }), i })),
    [store.ingredients, store.supplierById],
  );
  const rows = useMemo(() => {
    const list = q.trim() ? search(docs, q, 60).map((h) => h.doc) : docs.filter((d) => /keg/i.test(d.i.name)).sort((a, b) => a.i.name.localeCompare(b.i.name));
    return list.slice(0, 60);
  }, [docs, q]);
  return (
    <Sheet open={open} onClose={onClose} title="Choose Keg" cancelLabel="Cancel">
      <div className="pb-2 pt-3">
        <SearchField value={q} onChange={setQ} placeholder="Search kegs" autoFocus />
        <div className="group-list mt-3">
          {rows.map(({ i }) => (
            <Row
              key={i.id}
              onClick={() => {
                onPick(i.id);
                onClose();
              }}
              title={i.name}
              sub={[store.supplierById.get(i.supplier_id ?? -1)?.name, `${Number(i.pack_size)} L`].filter(Boolean).join(" · ")}
              trailing={<span className="text-label-2">{money(ingredientCostPerBase(i, store.settings.gst_rate))}/L</span>}
            />
          ))}
          {rows.length === 0 ? <p className="px-4 py-3 text-[15px] text-label-2">No keg matches. Add the keg as an ingredient priced per litre first.</p> : null}
        </div>
      </div>
    </Sheet>
  );
}
