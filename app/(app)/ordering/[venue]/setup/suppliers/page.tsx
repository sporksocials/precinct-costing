"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ensureTermsRow, OrderingError } from "@/lib/ordering-data";
import { bySortThenName, planAddSupplier, supplierGap, supplierSub, suppliersNotAtVenue } from "@/lib/ordering-setup";
import { countInactive, showInactiveLabel, visibleRecords } from "@/lib/active";
import { useStore } from "@/lib/store";
import { Banner, Empty, Group, PageHeader, Row } from "@/components/ui";
import { TitleWithTag } from "@/components/active-parts";
import { useUrlFlag } from "@/components/use-url-state";
import { useOrderingVenue } from "@/components/ordering/venue-context";
import { upsertById, useVenueData } from "@/components/ordering/use-venue-data";
import { TextField, TouchAddButton, TouchBack, TouchButton, TouchSearch, TouchSheet, TouchTextButton } from "@/components/ordering/touch";

export default function OrderingSuppliersPage() {
  const { venue, name, base } = useOrderingVenue();
  const router = useRouter();
  const store = useStore();
  const { sb, data, status, error, apply } = useVenueData(venue.id);
  const [showInactive, setShowInactive] = useUrlFlag("inactive");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [find, setFind] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const suppliers = data?.suppliers ?? [];
  const productCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of data?.products ?? []) if (p.active && p.supplier_id) m.set(p.supplier_id, (m.get(p.supplier_id) ?? 0) + 1);
    return m;
  }, [data?.products]);
  const shown = bySortThenName(visibleRecords(suppliers, showInactive));
  const inactive = countInactive(suppliers);
  // the one supplier list: what this venue could still add
  const available = useMemo(() => suppliersNotAtVenue(store.suppliers, suppliers), [store.suppliers, suppliers]);
  const findWords = find.trim().toLowerCase();
  const offered = findWords ? available.filter((s) => s.name.toLowerCase().includes(findWords)) : available;

  function openAdd() {
    setNewName("");
    setFind("");
    setAddError(null);
    setBusy(null);
    setAdding(true);
  }

  /** Makes this venue's terms row for a supplier in the list (the database finds or creates it), then opens it to set the terms. */
  async function addTerms(costSupplierId: number) {
    const row = await ensureTermsRow(sb, venue.id, costSupplierId);
    apply((d) => ({ ...d, suppliers: upsertById(d.suppliers, row) }));
    router.push(`${base}/setup/suppliers/${row.id}`);
  }

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label);
    setAddError(null);
    try {
      await work();
    } catch (e) {
      setAddError(e instanceof OrderingError || e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  function addNew() {
    const plan = planAddSupplier(newName, store.suppliers, suppliers);
    if (plan.kind === "empty" || plan.kind === "at_venue" || plan.kind === "inactive") return setAddError(plan.message);
    void run("new", async () => {
      // a name the list already has is used as it is; only a name nobody has is added to the list (Ingredients > Suppliers shows it)
      const id = plan.kind === "existing" ? plan.master.id : (await store.insertSupplier(plan.name)).supplier.id;
      await addTerms(id);
    });
  }

  return (
    <div className="max-w-2xl lg:pt-6">
      <TouchBack path={`${base}/setup`} fallback={`${base}/setup`}>
        Setup
      </TouchBack>
      <PageHeader title="Suppliers" subtitle={`Who ${name} orders from, and the terms`} trailing={<TouchAddButton label="Add Supplier" onClick={openAdd} />} className="lg:!pt-2" />
      {error && !data ? <Banner>{error}</Banner> : null}
      {inactive ? (
        <div className="flex justify-end">
          <TouchTextButton onClick={() => setShowInactive((v) => !v)}>{showInactiveLabel(showInactive, inactive)}</TouchTextButton>
        </div>
      ) : null}

      {status === "ready" && shown.length === 0 ? (
        <Empty title="No suppliers yet" body={`Add the suppliers ${name} orders from. They come from the supplier list on the Ingredients page, so a name is only ever kept once.`} />
      ) : (
        <Group className="mt-2">
          {shown.map((s) => {
            const gap = supplierGap(s);
            return (
              <Row
                key={s.id}
                href={`${base}/setup/suppliers/${s.id}`}
                title={<TitleWithTag name={s.name} active={s.active} />}
                sub={gap ? `${supplierSub(s, productCount.get(s.id) ?? 0)} · ${gap}` : supplierSub(s, productCount.get(s.id) ?? 0)}
                wrapSub
                chevron
                className="!min-h-[64px]"
              />
            );
          })}
        </Group>
      )}

      <TouchSheet open={adding} onClose={() => (busy ? undefined : setAdding(false))} title="Add Supplier">
        <div className="pb-2">
          {available.length > 0 ? (
            <>
              <p className="mb-2 text-[13px] font-medium text-label-2">Suppliers You Already Have</p>
              {available.length > 6 ? <TouchSearch value={find} onChange={setFind} placeholder="Search suppliers" label="Search suppliers" /> : null}
              <ul className="mt-2 max-h-64 overflow-y-auto overscroll-contain rounded-xl bg-fill" aria-label="Suppliers not yet at this venue">
                {offered.length === 0 ? <li className="px-4 py-3 text-[15px] text-label-2">No supplier matches. Add it as a new supplier below.</li> : null}
                {offered.map((s) => (
                  <li key={s.id} className="border-t border-[color:var(--separator)] first:border-t-0">
                    <button
                      type="button"
                      disabled={busy != null}
                      onClick={() => void run(`s${s.id}`, () => addTerms(s.id))}
                      className="flex min-h-[52px] w-full items-center justify-between gap-3 px-4 py-2 text-left text-[17px] transition-colors active:bg-fill-2 disabled:opacity-50"
                    >
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      <span className="shrink-0 text-[15px] font-semibold text-accent">{busy === `s${s.id}` ? "Adding..." : "Add"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-[15px] text-label-2">Every supplier in the list is already here.</p>
          )}

          <p className="mb-1 mt-5 text-[13px] font-medium text-label-2">Add A New Supplier</p>
          <div className="-mx-4">
            <TextField label="Supplier Name" value={newName} onCommit={() => undefined} onChangeText={setNewName} placeholder="Star, Lion, Coke" />
          </div>
          <TouchButton variant="primary" className="mt-1 w-full" disabled={busy != null || !newName.trim()} onClick={addNew}>
            {busy === "new" ? "Adding..." : "Add New Supplier"}
          </TouchButton>
          {addError ? (
            <p role="alert" className="mt-2 text-[13px] text-danger">
              {addError}
            </p>
          ) : null}
          <p className="mt-3 text-[13px] text-label-2">A new supplier joins the supplier list on the Ingredients page for every venue. Next you set how orders go out, the rep and any minimum.</p>
        </div>
      </TouchSheet>
    </div>
  );
}
