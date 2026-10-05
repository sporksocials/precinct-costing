"use client";

import { useParams } from "next/navigation";
import { useCallback, useState } from "react";
import { updateSupplier, type SupplierDraft } from "@/lib/ordering-data";
import { METHOD_HELP, METHOD_OPTIONS, moneyInput, nameTaken, parseMoney, parseQuantity, resolveContact, supplierGap } from "@/lib/ordering-setup";
import { qtyText } from "@/lib/ordering";
import { Banner, Empty, Group, PageHeader } from "@/components/ui";
import { useOrderingVenue } from "@/components/ordering/venue-context";
import { upsertById, useVenueData } from "@/components/ordering/use-venue-data";
import { ActiveSwitch, ChoiceBlock, SaveNote, SwitchRow, TextField, TouchBack, TouchLink, TouchSegmented } from "@/components/ordering/touch";
import type { OrderingMethod } from "@/lib/ordering-types";

type Save = { state: "idle" | "saving" | "saved" | "error"; message: string | null };

export default function OrderingSupplierPage() {
  const { id } = useParams<{ id: string }>();
  const { venue, name, base } = useOrderingVenue();
  const { sb, data, status, apply } = useVenueData(venue.id);
  const [save, setSave] = useState<Save>({ state: "idle", message: null });
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [notes, setNotes] = useState<Record<string, string | null>>({});
  const [bump, setBump] = useState(0);

  const supplier = data?.suppliers.find((s) => s.id === id) ?? null;
  const products = (data?.products ?? []).filter((p) => p.supplier_id === id);
  const activeProducts = products.filter((p) => p.active).length;

  const persist = useCallback(
    async (patch: Partial<SupplierDraft>): Promise<boolean> => {
      setSave({ state: "saving", message: null });
      try {
        const row = await updateSupplier(sb, id, patch);
        apply((d) => ({ ...d, suppliers: upsertById(d.suppliers, row) }));
        setSave({ state: "saved", message: null });
        return true;
      } catch (e) {
        setSave({ state: "error", message: e instanceof Error ? e.message : String(e) });
        return false;
      }
    },
    [sb, id, apply],
  );
  const setError = (k: string, v: string | null) => setErrors((e) => ({ ...e, [k]: v }));

  if (!supplier) {
    return (
      <div className="max-w-2xl lg:pt-6">
        <TouchBack path={`${base}/setup/suppliers`} fallback={`${base}/setup/suppliers`}>
          Suppliers
        </TouchBack>
        {status === "loading" ? <p className="mt-6 text-[15px] text-label-2">Loading...</p> : <Empty title="Supplier Not Found" body={`It may belong to another venue, or have been removed.`} action={<TouchLink href={`${base}/setup/suppliers`} variant="primary">Back To Suppliers</TouchLink>} />}
      </div>
    );
  }

  const text = (v: string | null | undefined) => v ?? "";
  const nullable = (t: string) => (t.trim() === "" ? null : t.trim());
  const gap = supplierGap(supplier);

  async function contact(field: "email_to" | "login_url", t: string) {
    const r = resolveContact(field, t, supplier!.method);
    setError(field, r.error);
    setNotes((n) => ({ ...n, contact: r.note }));
    if (r.error) return;
    if (r.moved) setBump((b) => b + 1);
    await persist(r.patch);
  }

  return (
    <div className="max-w-2xl lg:pt-6">
      <TouchBack path={`${base}/setup/suppliers`} fallback={`${base}/setup/suppliers`}>
        Suppliers
      </TouchBack>
      <PageHeader title={supplier.name} subtitle={`${name} only`} className="lg:!pt-2" />
      <SaveNote state={save.state} message={save.message} />
      {gap ? <Banner tone="neutral">{gap}</Banner> : null}

      <Group title="Supplier">
        <TextField
          label="Name"
          value={supplier.name}
          error={errors.name}
          onCommit={(t) => {
            const n = t.trim();
            if (!n) return setError("name", "A supplier needs a name.");
            if (nameTaken(n, data?.suppliers ?? [], supplier.id)) return setError("name", `${name} already has a supplier called ${n}.`);
            setError("name", null);
            void persist({ name: n });
          }}
        />
      </Group>

      <Group title="How Orders Go Out" footer={METHOD_HELP[supplier.method]}>
        <ChoiceBlock label="Method">
          <TouchSegmented ariaLabel="How orders go out" options={METHOD_OPTIONS} value={supplier.method} onChange={(m: OrderingMethod) => void persist({ method: m })} />
        </ChoiceBlock>
        <TextField key={`email-${bump}`} label="Email Address" inputMode="email" type="email" placeholder="orders@supplier.com.au" value={text(supplier.email_to)} error={errors.email_to} hint="Separate several addresses with commas." onCommit={(t) => void contact("email_to", t)} />
        <TextField key={`login-${bump}`} label="Login Link" inputMode="url" type="url" placeholder="www.supplier.com.au" value={text(supplier.login_url)} error={errors.login_url} onCommit={(t) => void contact("login_url", t)} />
        {notes.contact ? (
          <p className="px-4 pb-3 text-[13px] text-label" role="status">
            {notes.contact}
          </p>
        ) : null}
      </Group>

      <Group title="Rep And Account">
        <TextField label="Rep Name" value={text(supplier.rep_name)} placeholder="First name is used in the greeting" onCommit={(t) => void persist({ rep_name: nullable(t) })} />
        <TextField label="Rep Phone" inputMode="tel" type="tel" value={text(supplier.rep_phone)} onCommit={(t) => void persist({ rep_phone: nullable(t) })} />
        <TextField label="Account Number" value={text(supplier.account_no)} onCommit={(t) => void persist({ account_no: nullable(t) })} />
      </Group>

      <Group title="Minimum Order" footer="A warning on the order screen only. An order is never blocked.">
        <TextField
          label="Minimum Dollars"
          inputMode="decimal"
          prefix="$"
          value={moneyInput(supplier.min_order_value)}
          error={errors.min_order_value}
          hint="Compared with the order total ex GST."
          onCommit={(t) => {
            const v = t.trim() === "" ? null : parseMoney(t);
            if (t.trim() !== "" && v == null) return setError("min_order_value", "Type an amount like 150.");
            setError("min_order_value", null);
            void persist({ min_order_value: v });
          }}
        />
        <TextField
          label="Minimum Units"
          inputMode="numeric"
          value={supplier.min_order_units == null ? "" : qtyText(supplier.min_order_units)}
          error={errors.min_order_units}
          hint="Cartons, kegs or bottles."
          onCommit={(t) => {
            const v = t.trim() === "" ? null : parseQuantity(t);
            if (t.trim() !== "" && v == null) return setError("min_order_units", "Type a number like 4.");
            setError("min_order_units", null);
            void persist({ min_order_units: v });
          }}
        />
      </Group>

      <Group title="Order Text">
        <SwitchRow checked={supplier.show_prices_on_order} onChange={(v) => void persist({ show_prices_on_order: v })} label="Show Prices On Order" sub="Prints each line price and the total ex and inc GST, for suppliers that need it so the people receiving the delivery can check what was agreed." />
      </Group>

      <Group>
        <TextField label="Notes" multiline value={text(supplier.notes)} placeholder="Delivery days, cut-off times, minimums shared with another venue" onCommit={(t) => void persist({ notes: nullable(t) })} />
      </Group>

      <Group>
        <ActiveSwitch checked={supplier.active} onChange={(v) => void persist({ active: v })} sub="Off hides this supplier from new orders. Its products and past orders stay. Nothing is deleted." />
      </Group>

      <Group title="Products" footer={products.length ? `${activeProducts} active of ${products.length} products use ${supplier.name}.` : `No products use ${supplier.name} yet.`}>
        <div className="px-4 py-2">
          <TouchLink href={`${base}/setup/products?q=${encodeURIComponent(supplier.name)}`} className="w-full sm:w-auto">
            See Its Products
          </TouchLink>
        </div>
      </Group>
    </div>
  );
}
