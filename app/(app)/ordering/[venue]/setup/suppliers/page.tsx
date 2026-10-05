"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createSupplier, blankSupplier, OrderingError } from "@/lib/ordering-data";
import { bySortThenName, nameTaken, supplierGap, supplierSub } from "@/lib/ordering-setup";
import { countInactive, showInactiveLabel, visibleRecords } from "@/lib/active";
import { Banner, Empty, Group, PageHeader, Row } from "@/components/ui";
import { TitleWithTag } from "@/components/active-parts";
import { useUrlFlag } from "@/components/use-url-state";
import { useOrderingVenue } from "@/components/ordering/venue-context";
import { upsertById, useVenueData } from "@/components/ordering/use-venue-data";
import { TextField, TouchAddButton, TouchBack, TouchSheet, TouchTextButton } from "@/components/ordering/touch";

export default function OrderingSuppliersPage() {
  const { venue, name, base } = useOrderingVenue();
  const router = useRouter();
  const { sb, data, status, error, apply } = useVenueData(venue.id);
  const [showInactive, setShowInactive] = useUrlFlag("inactive");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const suppliers = data?.suppliers ?? [];
  const productCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of data?.products ?? []) if (p.active && p.supplier_id) m.set(p.supplier_id, (m.get(p.supplier_id) ?? 0) + 1);
    return m;
  }, [data?.products]);
  const shown = bySortThenName(visibleRecords(suppliers, showInactive));
  const inactive = countInactive(suppliers);

  async function create() {
    const n = newName.trim();
    if (!n) return setAddError("Type the supplier's name.");
    if (nameTaken(n, suppliers)) return setAddError(`${name} already has a supplier called ${n}.`);
    setBusy(true);
    setAddError(null);
    try {
      const sort = Math.max(0, ...suppliers.map((s) => s.sort)) + 1;
      const row = await createSupplier(sb, venue.id, { ...blankSupplier(n), sort });
      apply((d) => ({ ...d, suppliers: upsertById(d.suppliers, row) }));
      router.push(`${base}/setup/suppliers/${row.id}`);
    } catch (e) {
      setAddError(e instanceof OrderingError || e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl lg:pt-6">
      <TouchBack path={`${base}/setup`} fallback={`${base}/setup`}>
        Setup
      </TouchBack>
      <PageHeader title="Suppliers" subtitle={`${name} only`} trailing={<TouchAddButton label="Add Supplier" onClick={() => { setNewName(""); setAddError(null); setBusy(false); setAdding(true); }} />} className="lg:!pt-2" />
      {error && !data ? <Banner>{error}</Banner> : null}
      {inactive ? (
        <div className="flex justify-end">
          <TouchTextButton onClick={() => setShowInactive((v) => !v)}>{showInactiveLabel(showInactive, inactive)}</TouchTextButton>
        </div>
      ) : null}

      {status === "ready" && shown.length === 0 ? (
        <Empty title="No suppliers yet" body={`Add the suppliers ${name} orders from. Each product then points at one.`} />
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

      <TouchSheet open={adding} onClose={() => (busy ? undefined : setAdding(false))} title="Add Supplier" action={{ label: busy ? "Adding..." : "Add", onClick: () => void create(), disabled: busy }}>
        <div className="-mx-4">
          <TextField label="Supplier Name" value={newName} onCommit={() => undefined} onChangeText={setNewName} placeholder="Star, Lion, Coke" error={addError} autoFocus />
        </div>
        <p className="pb-2 text-[13px] text-label-2">Next you set how orders go out, the rep and any minimum.</p>
      </TouchSheet>
    </div>
  );
}
