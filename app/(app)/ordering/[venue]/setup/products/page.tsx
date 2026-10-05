"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { blankProduct, createProduct, OrderingError } from "@/lib/ordering-data";
import { qtyText } from "@/lib/ordering";
import { applySort, bySortThenName, inactiveProductCount, moveItem, nameTaken, productGroups, productSub, sortChanges, UNIT_CHOICE_OPTIONS, unitChoice, unitTitle, type UnitChoice } from "@/lib/ordering-setup";
import { saveSortChanges } from "@/lib/ordering-screens-data";
import { showInactiveLabel } from "@/lib/active";
import { Banner, cx, Empty, PageHeader, Row } from "@/components/ui";
import { TitleWithTag } from "@/components/active-parts";
import { useUrlFlag, useUrlState } from "@/components/use-url-state";
import { useOrderingVenue } from "@/components/ordering/venue-context";
import { upsertById, useVenueData } from "@/components/ordering/use-venue-data";
import { SortableRows } from "@/components/ordering/sortable";
import { ChoiceBlock, SaveNote, TextField, TouchAddButton, TouchBack, TouchChips, TouchLink, TouchSearch, TouchSheet, TouchTextButton } from "@/components/ordering/touch";
import type { OrderingProduct } from "@/lib/ordering-types";

type Save = { state: "idle" | "saving" | "saved" | "error"; message: string | null };

export default function OrderingProductsPage() {
  const { venue, name, base } = useOrderingVenue();
  const router = useRouter();
  const { sb, data, status, error, apply, reload } = useVenueData(venue.id);
  const [cat, setCat] = useUrlState("cat", "");
  const [q, setQ] = useUrlState("q", "");
  const [showInactive, setShowInactive] = useUrlFlag("inactive");
  const [reorderId, setReorderId] = useUrlState("reorder", "");
  const [save, setSave] = useState<Save>({ state: "idle", message: null });

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCat, setNewCat] = useState("");
  const [newUnit, setNewUnit] = useState("carton");
  const [otherUnit, setOtherUnit] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const unitPicked = useRef(false);

  const categories = useMemo(() => bySortThenName(data?.categories ?? []), [data?.categories]);
  const suppliers = useMemo(() => data?.suppliers ?? [], [data?.suppliers]);
  const products = useMemo(() => data?.products ?? [], [data?.products]);
  const supplierName = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);
  const catId = categories.some((c) => c.id === cat) ? cat : "";
  const reorderCat = categories.find((c) => c.id === reorderId) ?? null;
  const inactive = inactiveProductCount(products);

  const groups = useMemo(() => productGroups({ products, categories, suppliers, categoryId: catId, query: q, showInactive }), [products, categories, suppliers, catId, q, showInactive]);
  const shownCount = groups.reduce((n, g) => n + g.products.length, 0);

  const onMove = useCallback(
    async (rows: OrderingProduct[], from: number, to: number) => {
      const changes = sortChanges(moveItem(rows, from, to));
      if (!changes.length) return;
      apply((d) => ({ ...d, products: applySort(d.products, changes) }));
      setSave({ state: "saving", message: null });
      try {
        await saveSortChanges(sb, "products", changes);
        setSave({ state: "saved", message: null });
      } catch (e) {
        setSave({ state: "error", message: `${e instanceof Error ? e.message : String(e)} The order on screen was put back.` });
        void reload();
      }
    },
    [apply, sb, reload],
  );

  function openAdd() {
    const first = categories.find((c) => c.id === catId) ?? categories[0];
    setNewName("");
    setNewCat(first?.id ?? "");
    setNewUnit(first?.unit_name ?? "carton");
    setOtherUnit(unitChoice(first?.unit_name) === "other");
    unitPicked.current = false;
    setAddError(null);
    setBusy(false);
    setAdding(true);
  }

  async function create() {
    const n = newName.trim();
    if (!newCat) return setAddError(`Add a category first. ${name} needs at least one under Setup.`);
    if (!n) return setAddError("Type the product's name.");
    if (nameTaken(n, products.filter((p) => p.category_id === newCat))) return setAddError("That category already has a product with that name.");
    const unit = newUnit.trim();
    if (!unit) return setAddError("Type the unit's name.");
    setBusy(true);
    setAddError(null);
    try {
      const sort = Math.max(0, ...products.filter((p) => p.category_id === newCat).map((p) => p.sort)) + 1;
      const row = await createProduct(sb, venue.id, { ...blankProduct(newCat, n, unit.toLowerCase()), sort });
      apply((d) => ({ ...d, products: upsertById(d.products, row) }));
      router.push(`${base}/setup/products/${row.id}`);
    } catch (e) {
      setAddError(e instanceof OrderingError || e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const unitPick: UnitChoice = otherUnit ? "other" : unitChoice(newUnit);

  const rowLink = (p: OrderingProduct) => `${base}/setup/products/${p.id}`;

  /* ---------------------------------------------------------------- reorder mode */
  if (reorderCat) {
    const rows = bySortThenName(products.filter((p) => p.category_id === reorderCat.id));
    return (
      <div className="max-w-2xl lg:pt-6">
        <TouchBack path={`${base}/setup`} fallback={`${base}/setup`}>
          Setup
        </TouchBack>
        <PageHeader title={reorderCat.name} subtitle="Reordering products" trailing={<TouchTextButton onClick={() => setReorderId("")}>Done</TouchTextButton>} className="lg:!pt-2" />
        <p className="text-[15px] text-label-2">The count lists products in this order. Drag the handle, or use the arrows.</p>
        <SaveNote state={save.state} message={save.message} />
        <div className="mt-3">
          <SortableRows
            items={rows}
            getId={(p) => p.id}
            getLabel={(p) => p.name}
            onMove={(f, t) => void onMove(rows, f, t)}
            renderBody={(p: OrderingProduct) => (
              <div className="flex min-h-[56px] flex-col justify-center px-1">
                <span className="block truncate text-[17px]">
                  <TitleWithTag name={p.name} active={p.active} />
                </span>
                <span className="block text-[13px] text-label-2">{productSub(p, supplierName)}</span>
              </div>
            )}
          />
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- the list */
  return (
    <div className="max-w-5xl lg:pt-6">
      <TouchBack path={`${base}/setup`} fallback={`${base}/setup`}>
        Setup
      </TouchBack>
      <PageHeader title="Products" subtitle={`${name} only`} trailing={<TouchAddButton label="Add Product" onClick={openAdd} />} className="lg:!pt-2" />
      {error && !data ? <Banner>{error}</Banner> : null}

      <div className="space-y-3">
        <TouchSearch value={q} onChange={setQ} placeholder="Search products or suppliers" label="Search products" />
        {categories.length > 0 ? <TouchChips ariaLabel="Category" value={catId} onChange={setCat} options={[{ value: "", label: "All" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]} /> : null}
      </div>
      <div className="mt-1 flex items-center justify-between">
        <p className="text-[13px] text-label-2" aria-live="polite">
          {status === "ready" ? `${shownCount} product${shownCount === 1 ? "" : "s"}` : ""}
        </p>
        {inactive ? <TouchTextButton onClick={() => setShowInactive((v) => !v)}>{showInactiveLabel(showInactive, inactive)}</TouchTextButton> : <span />}
      </div>

      {status === "ready" && categories.length === 0 ? (
        <Empty
          title="Add Categories First"
          body={`Products sit in categories like Kegs or Spirits, and the count follows their order. Add ${name}'s categories, then come back here. Or go back to Setup and copy another venue's list.`}
          action={
            <TouchLink href={`${base}/setup/categories`} variant="primary">
              Add Categories
            </TouchLink>
          }
        />
      ) : status === "ready" && products.length === 0 ? (
        <Empty title={`${name} has no products yet`} body="Add the first one with the plus button, or go back and copy another venue's list." />
      ) : status === "ready" && groups.length === 0 ? (
        <Empty title="Nothing matches" body={q ? "Try fewer words, or clear the category." : "This category has no products yet."} />
      ) : null}

      {groups.map((g) => (
        <section key={g.category.id} className="mt-4" aria-label={g.category.name}>
          <div className="flex items-center justify-between px-4">
            <h2 className="text-[13px] font-medium text-label-2">
              {g.category.name} · {g.products.length}
            </h2>
            <TouchTextButton ariaLabel={`Reorder ${g.category.name}`} onClick={() => setReorderId(g.category.id)}>
              Reorder
            </TouchTextButton>
          </div>

          {/* phones and tablets: rows */}
          <div className="group-list xl:hidden">
            {g.products.map((p) => (
              <Row
                key={p.id}
                href={rowLink(p)}
                title={<TitleWithTag name={p.name} active={p.active} />}
                sub={productSub(p, supplierName)}
                trailing={<span className="text-[15px]">Build To {qtyText(p.par)}</span>}
                chevron
                className="!min-h-[64px]"
              />
            ))}
          </div>

          {/* desktop: a table */}
          <div className="hidden overflow-hidden rounded-2xl bg-surface xl:block">
            <table className="w-full table-fixed text-left text-[15px]">
              <colgroup>
                <col />
                <col className="w-[100px]" />
                <col className="w-[150px]" />
                <col className="w-[110px]" />
                <col className="w-[70px]" />
                <col className="w-[130px]" />
                <col className="w-[100px]" />
              </colgroup>
              <thead>
                <tr className="text-[13px] text-label-2">
                  <th scope="col" className="px-4 py-2.5 font-medium">Product</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Unit</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Supplier</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Item Code</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Pack</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Price Inc GST</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Build To</th>
                </tr>
              </thead>
              <tbody>
                {g.products.map((p) => (
                  <tr key={p.id} className="relative border-t border-[color:var(--separator)] hover:bg-fill">
                    <th scope="row" className="min-h-[56px] px-4 py-0 font-normal">
                      <Link href={rowLink(p)} className="flex min-h-[56px] items-center after:absolute after:inset-0 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--label)]">
                        <TitleWithTag name={p.name} active={p.active} />
                      </Link>
                    </th>
                    <td className="px-3 text-label-2">{unitTitle(p.unit_name)}</td>
                    <td className={cx("px-3", p.supplier_id ? "text-label-2" : "text-label-3")}>{p.supplier_id ? supplierName.get(p.supplier_id) ?? "Removed" : "No supplier"}</td>
                    <td className="px-3 tnum text-label-2">{p.supplier_item_code ?? ""}</td>
                    <td className="px-3 text-right tnum text-label-2">{p.pack_multiple > 1 ? `x ${p.pack_multiple}` : ""}</td>
                    <td className="px-3 text-right tnum text-label-2">{p.price_inc_gst != null ? `$${Number(p.price_inc_gst).toFixed(2)}` : ""}</td>
                    <td className="px-4 text-right tnum">{qtyText(p.par)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <TouchSheet open={adding} onClose={() => (busy ? undefined : setAdding(false))} title="Add Product" action={{ label: busy ? "Adding..." : "Add", onClick: () => void create(), disabled: busy }}>
        <div className="-mx-4">
          <TextField label="Product Name" value={newName} onCommit={() => undefined} onChangeText={setNewName} placeholder="XXXX Gold Keg" error={addError} autoFocus />
          <ChoiceBlock label="Category">
            <TouchChips
              wrap
              ariaLabel="Category"
              value={newCat}
              onChange={(v) => {
                setNewCat(v);
                if (!unitPicked.current) {
                  const u = categories.find((c) => c.id === v)?.unit_name ?? "carton";
                  setNewUnit(u);
                  setOtherUnit(unitChoice(u) === "other");
                }
              }}
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
            />
          </ChoiceBlock>
          <ChoiceBlock label="Unit" hint="What is counted and ordered: one carton, one keg, one bottle.">
            <TouchChips
              wrap
              ariaLabel="Unit"
              value={unitPick}
              onChange={(v) => {
                unitPicked.current = true;
                setOtherUnit(v === "other");
                if (v !== "other") setNewUnit(v);
                else setNewUnit("");
              }}
              options={UNIT_CHOICE_OPTIONS}
            />
            {unitPick === "other" ? (
              <div className="-mx-4 mt-1">
                <TextField label="Unit Name" value={newUnit} onCommit={() => undefined} onChangeText={setNewUnit} placeholder="tray" />
              </div>
            ) : null}
          </ChoiceBlock>
        </div>
        <p className="pb-2 text-[13px] text-label-2">Next you set the supplier, price and Build To.</p>
      </TouchSheet>
    </div>
  );
}
