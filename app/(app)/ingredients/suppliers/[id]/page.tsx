"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { useStore } from "@/lib/store";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { loadInvoiceSupplierLinks, loadSupplierTerms } from "@/lib/ordering-link";
import { ACTIVE_LABEL } from "@/lib/active";
import {
  ingredientCountText,
  ingredientsToMove,
  isSupplierActive,
  moveImpactText,
  orderedAtText,
  retireBlocker,
  supplierChoices,
  supplierClash,
  supplierClashMessage,
} from "@/lib/suppliers";
import { nameList } from "@/lib/record-usage";
import type { Supplier } from "@/lib/types";
import { RenameTitle } from "@/components/rename-title";
import { AddSupplier } from "@/components/add-supplier";
import { InactiveTag, TitleWithTag } from "@/components/active-parts";
import { VenueTag } from "@/components/brand";
import { Banner, Empty, FieldRow, Group, InlineInput, Row, Sheet, Toggle, useToast } from "@/components/ui";

export default function SupplierPage() {
  const { id } = useParams<{ id: string }>();
  const store = useStore();
  const supplier = store.suppliers.find((s) => String(s.id) === id);
  if (!supplier)
    return (
      <Empty
        title="Supplier Not Found"
        action={
          <Link className="btn-primary" href="/ingredients?type=suppliers">
            Back to Suppliers
          </Link>
        }
      />
    );
  return <Detail key={supplier.id} supplier={supplier} />;
}

function Detail({ supplier }: { supplier: Supplier }) {
  const store = useStore();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [terms, setTerms] = useState<{ id: string; cost_supplier_id: number; venue_id: number; active: boolean }[]>([]);
  const [invoicesLinked, setInvoicesLinked] = useState(false);
  const active = isSupplierActive(supplier);

  // the ordering terms and invoice link are extras: the page works without them
  useEffect(() => {
    const sb = getSupabaseBrowser();
    let cancelled = false;
    sb.from("ordering_suppliers")
      .select("id,cost_supplier_id,venue_id,active")
      .eq("cost_supplier_id", supplier.id)
      .then(({ data }) => !cancelled && setTerms(((data ?? []) as typeof terms).filter((t) => t.active !== false)));
    loadInvoiceSupplierLinks(sb).then((l) => !cancelled && setInvoicesLinked(l.includes(supplier.id))).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [supplier.id]);

  const mine = useMemo(() => store.ingredients.filter((i) => i.supplier_id === supplier.id).sort((a, b) => a.name.localeCompare(b.name)), [store.ingredients, supplier.id]);
  const liveCount = mine.filter((i) => i.active).length;
  const blocker = retireBlocker(liveCount);
  const venueNames = useMemo(() => terms.map((t) => store.venues.find((v) => v.id === t.venue_id)).filter((v): v is NonNullable<typeof v> => !!v), [terms, store.venues]);

  const save = async (patch: Partial<Pick<Supplier, "name" | "portal_url" | "notes" | "active">>) => {
    setError(null);
    try {
      await store.updateSupplier(supplier.id, patch);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  async function turnOff() {
    setBusy(true);
    try {
      await store.updateSupplier(supplier.id, { active: false });
      setConfirmOff(false);
      toast.show({ message: `${supplier.name} is now inactive`, action: { label: "Undo", onClick: () => void store.updateSupplier(supplier.id, { active: true }).catch((e) => setError(e instanceof Error ? e.message : String(e))) } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pb-8">
      <div className="pt-3 lg:pt-8">
        <BackLink path="/ingredients" fallback="/ingredients?type=suppliers" rules={{ require: { key: "type", value: "suppliers" } }} className="btn-text -ml-1 !gap-0">
          <ChevronLeft className="h-6 w-6" strokeWidth={2.25} />
          Suppliers
        </BackLink>
      </div>
      <RenameTitle
        name={supplier.name}
        kind="ingredient"
        onSave={async (name) => {
          await store.updateSupplier(supplier.id, { name });
          return `Renamed to ${name}. Order lists now say ${name} too.`;
        }}
        taken={(n) => {
          const c = supplierClash(n, store.suppliers, supplier.id);
          return c ? supplierClashMessage(c) : null;
        }}
      />
      <p className="mt-1 text-[15px] text-label-2">
        {ingredientCountText(mine.length)} · {orderedAtText(venueNames.map((v) => v.name))}
        {invoicesLinked ? " · Invoices linked" : ""}
        {!active ? <InactiveTag /> : null}
      </p>
      {error ? <Banner>{error}</Banner> : null}

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-8">
        <div>
          <Group title="Details" className="mt-5">
            <FieldRow label="Portal Link">
              <InlineInput value={supplier.portal_url ?? ""} placeholder="None" inputMode="url" type="url" width="w-56" align="right" ariaLabel="Portal link" onCommit={(t) => void save({ portal_url: t.trim() || null })} />
            </FieldRow>
            <div className="px-4 py-2.5">
              <textarea
                rows={3}
                aria-label="Notes"
                defaultValue={supplier.notes ?? ""}
                placeholder="Notes"
                onBlur={(e) => (e.target.value.trim() || null) !== (supplier.notes ?? null) && void save({ notes: e.target.value.trim() || null })}
                className="block w-full resize-none bg-transparent text-[17px] outline-none placeholder:text-label-3 sm:text-[15px]"
              />
            </div>
          </Group>

          <div className="group-list mt-4">
            <Toggle
              label={ACTIVE_LABEL}
              sub={
                active && blocker ? (
                  <span className="font-medium text-warn">{blocker}</span>
                ) : (
                  "Off hides this supplier from supplier lists. Ingredients that already have it keep showing it. Nothing is deleted."
                )
              }
              checked={active}
              disabled={active && !!blocker}
              onChange={(v) => (v ? void save({ active: true }) : setConfirmOff(true))}
            />
          </div>

          {venueNames.length ? (
            <Group title="Order Lists" className="mt-6" footer="Rep, email, minimums and how it is sent are set for each venue under Ordering.">
              {terms.map((t) => {
                const v = store.venues.find((x) => x.id === t.venue_id);
                return v ? <Row key={t.id} href={`/ordering/${v.slug}/setup/suppliers/${t.id}`} title={<VenueTag slug={v.slug} name={v.name} />} sub="Ordering terms" chevron /> : null;
              })}
            </Group>
          ) : null}

          <Group title="Move Items To Another Supplier" className="mt-6" footer="This is how you retire a supplier: move its items to the one you are keeping, then make it inactive.">
            <div className="px-4 py-3">
              <button type="button" className="btn-tinted w-full !min-h-[44px] sm:w-auto" disabled={mine.length === 0} onClick={() => setMoving(true)}>
                {mine.length === 0 ? "No Items To Move" : `Move ${ingredientCountText(mine.length)}`}
              </button>
            </div>
          </Group>
        </div>

        <div>
          <Group title={`Ingredients ${mine.length}`} className="mt-7 lg:mt-5">
            {mine.length === 0 ? <p className="px-4 py-3 text-[15px] text-label-2">No ingredient uses this supplier.</p> : null}
            {mine.map((i) => (
              <Row key={i.id} href={`/ingredients/${i.id}`} title={<TitleWithTag name={i.name} active={i.active} />} sub={i.category} chevron />
            ))}
          </Group>
        </div>
      </div>

      {moving ? (
        <MoveSheet
          supplier={supplier}
          onClose={() => setMoving(false)}
          onMoved={(count, target, movedIds) => {
            setMoving(false);
            toast.show({
              message: `${ingredientCountText(count)} moved to ${target.name}`,
              action: { label: "Undo", onClick: () => void store.moveIngredientsSupplier(movedIds, target.id, supplier.id).catch((e) => setError(e instanceof Error ? e.message : String(e))) },
            });
          }}
        />
      ) : null}

      <Sheet open={confirmOff} onClose={() => (busy ? undefined : setConfirmOff(false))} hideHeader size="sm">
        <div className="pb-2 pt-5 text-center">
          <p className="text-[20px] font-semibold">Make “{supplier.name}” Inactive?</p>
          <p className="mx-auto mt-1.5 max-w-xs text-[15px] text-label-2">It will be hidden from supplier lists. Ingredients that already have it keep showing it, and its order terms stay as they are.</p>
          <div className="mt-5 space-y-2">
            <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => void turnOff()}>
              {busy ? "Saving…" : "Make Inactive"}
            </button>
            <button type="button" className="btn-plain w-full" disabled={busy} onClick={() => setConfirmOff(false)}>
              Cancel
            </button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

/** Pick the supplier to move every item to, read the impact, then move. Nothing changes until Move Items. */
function MoveSheet({ supplier, onClose, onMoved }: { supplier: Supplier; onClose: () => void; onMoved: (count: number, target: Supplier, movedIds: string[]) => void }) {
  const store = useStore();
  const [targetId, setTargetId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = useMemo(() => ingredientsToMove(store.ingredients, supplier.id), [store.ingredients, supplier.id]);
  const choices = useMemo(() => supplierChoices(store.suppliers, null).filter((s) => s.id !== supplier.id), [store.suppliers, supplier.id]);
  const target = choices.find((s) => s.id === targetId) ?? null;
  const names = nameList(items, 6);

  async function move() {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      const moved = await store.moveIngredientsSupplier(items.map((i) => i.id), supplier.id, target.id);
      if (moved.length === 0) throw new Error("Nothing moved. Someone may have changed these already. Refresh and try again.");
      onMoved(moved.length, target, moved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={() => (busy ? undefined : onClose())} title="Move Items" action={{ label: busy ? "Moving…" : "Move", onClick: () => void move(), disabled: !target || busy }}>
      <div className="space-y-4 pb-2 pt-3">
        {error ? <Banner>{error}</Banner> : null}
        <div>
          <p className="section-label !px-1">Move To</p>
          <select className="field appearance-none" aria-label="Move to supplier" value={targetId ?? ""} onChange={(e) => setTargetId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Pick a supplier</option>
            {choices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <AddSupplier className="mt-1" selecting onAdded={(s) => setTargetId(s.id)} />
        </div>
        {target ? (
          <div className="rounded-2xl bg-surface-2 px-4 py-3">
            <p className="text-[17px] font-semibold sm:text-[15px]">{moveImpactText(items.length, target.name)}</p>
            <p className="mt-1 text-[15px] text-label-2 sm:text-[13px]">
              {names.text}
              {items.some((i) => !i.active) ? " Inactive ingredients move too." : ""}
            </p>
          </div>
        ) : (
          <p className="px-1 text-[15px] text-label-2 sm:text-[13px]">Pick the supplier you are keeping. You will see what changes before anything moves.</p>
        )}
        <button type="button" className="btn-primary w-full !min-h-[44px]" disabled={!target || busy} onClick={() => void move()}>
          {busy ? "Moving…" : target ? `Move To ${target.name}` : "Move Items"}
        </button>
      </div>
    </Sheet>
  );
}
