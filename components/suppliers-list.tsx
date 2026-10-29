"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { loadInvoiceSupplierLinks, loadSupplierTerms } from "@/lib/ordering-link";
import { ingredientCountText, orderedAtText, summariseSuppliers, type SupplierSummary } from "@/lib/suppliers";
import { countInactive, visibleRecords } from "@/lib/active";
import { useUrlFlag } from "./use-url-state";
import { DataTable } from "./table";
import { AddSupplier } from "./add-supplier";
import { ShowInactiveButton, TitleWithTag } from "./active-parts";
import { VenueTag } from "./brand";
import { Empty, Row } from "./ui";

/**
 * Ingredients > Suppliers (Troy, 29 Oct 2026: one supplier list). Every supplier, how many ingredients use it, the venues it is
 * ordered at and a quiet "Invoices linked" tag. Inactive suppliers are hidden unless Show Inactive is on. A supplier opens its own
 * page, where it is renamed, retired and its items are moved.
 */
export function SuppliersList({ adding, setAdding }: { adding: boolean; setAdding: (v: boolean) => void }) {
  const store = useStore();
  const router = useRouter();
  const [showInactive, setShowInactive] = useUrlFlag("inactive");
  const [terms, setTerms] = useState<{ cost_supplier_id: number; venue_id: number; active: boolean }[]>([]);
  const [invoiceLinks, setInvoiceLinks] = useState<number[]>([]);

  // the ordering and invoice links are extras: the list works without them (before they load, or if they cannot be read)
  useEffect(() => {
    const sb = getSupabaseBrowser();
    let cancelled = false;
    loadSupplierTerms(sb).then((t) => !cancelled && setTerms(t)).catch(() => undefined);
    loadInvoiceSupplierLinks(sb).then((l) => !cancelled && setInvoiceLinks(l)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const all = useMemo(
    () =>
      summariseSuppliers({
        suppliers: store.suppliers,
        ingredients: store.ingredients,
        terms,
        venueName: (id) => store.venues.find((v) => v.id === id)?.name,
        invoiceLinks,
      }),
    [store.suppliers, store.ingredients, store.venues, terms, invoiceLinks],
  );
  const inactiveCount = useMemo(() => countInactive(all), [all]);
  const rows = useMemo(() => visibleRecords(all, showInactive), [all, showInactive]);
  const slugOf = (venueName: string) => store.venues.find((v) => v.name === venueName)?.slug;

  const venuesCell = (s: SupplierSummary) =>
    s.venues.length ? (
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-label-2">
        {s.venues.map((n) => (
          <VenueTag key={n} slug={slugOf(n)} name={n} size={16} />
        ))}
      </span>
    ) : (
      <span className="text-label-3">Not on any order list</span>
    );
  const tag = (s: SupplierSummary) => (s.invoicesLinked ? <span className="rounded-md bg-fill px-1.5 py-0.5 text-[12px] font-medium text-label-2">Invoices linked</span> : null);

  return (
    <div>
      {adding ? (
        <div className="mb-3 rounded-2xl bg-surface p-4">
          <AddSupplier
            startOpen
            selecting={false}
            onCancel={() => setAdding(false)}
            onAdded={(s) => {
              setAdding(false);
              router.push(`/ingredients/suppliers/${s.id}`);
            }}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pb-1.5 pt-2">
        <p className="text-[13px] text-label-2">{rows.length} {rows.length === 1 ? "supplier" : "suppliers"}</p>
        <ShowInactiveButton count={inactiveCount} show={showInactive} onToggle={() => setShowInactive((x) => !x)} />
      </div>
      {rows.length === 0 ? (
        <Empty title="No Suppliers Yet" body="Add a supplier, then pick it on an ingredient." />
      ) : (
        <>
          <div className="hidden lg:block">
            <DataTable
              rows={rows}
              rowKey={(s) => String(s.id)}
              href={(s) => `/ingredients/suppliers/${s.id}`}
              initialSort={{ key: "name", dir: "asc" }}
              columns={[
                { key: "name", label: "Supplier", render: (s) => <span className="font-medium"><TitleWithTag name={s.name} active={s.active} /></span>, sort: (s) => s.name },
                { key: "n", label: "Ingredients", align: "right", render: (s) => <span className="text-label-2">{s.ingredients || "—"}</span>, sort: (s) => s.ingredients },
                { key: "venues", label: "Ordered At", render: venuesCell },
                { key: "inv", label: "Invoices", render: (s) => tag(s) ?? <span className="text-label-3">—</span> },
              ]}
            />
          </div>
          <div className="group-list lg:hidden">
            {rows.map((s) => (
              <Row
                key={s.id}
                href={`/ingredients/suppliers/${s.id}`}
                title={<TitleWithTag name={s.name} active={s.active} />}
                sub={`${ingredientCountText(s.ingredients)} · ${orderedAtText(s.venues)}`}
                trailing={tag(s)}
                chevron
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
