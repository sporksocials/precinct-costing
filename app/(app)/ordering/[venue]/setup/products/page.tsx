"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { qtyText } from "@/lib/ordering";
import { orderPriceShort } from "@/lib/ordering-facts";
import { NEEDS_INGREDIENT, ingredientOrderingHref } from "@/lib/ordering-orders-ui";
import { applySort, bySortThenName, inactiveProductCount, moveItem, productGroups, productSub, sortChanges, unitTitle } from "@/lib/ordering-setup";
import { saveSortChanges } from "@/lib/ordering-screens-data";
import { showInactiveLabel } from "@/lib/active";
import { Banner, cx, Empty, PageHeader, Row } from "@/components/ui";
import { TitleWithTag } from "@/components/active-parts";
import { useUrlFlag, useUrlState } from "@/components/use-url-state";
import { useOrderingVenue } from "@/components/ordering/venue-context";
import { useVenueData } from "@/components/ordering/use-venue-data";
import { useOrderFacts } from "@/components/ordering/use-order-facts";
import { SortableRows } from "@/components/ordering/sortable";
import { SaveNote, TouchBack, TouchChips, TouchLink, TouchSearch, TouchTextButton } from "@/components/ordering/touch";
import type { OrderingProduct } from "@/lib/ordering-types";

type Save = { state: "idle" | "saving" | "saved" | "error"; message: string | null };

/**
 * Setup > Products: this venue's order list in SHELF ORDER, read only (one card per product, Troy, 23 Nov 2026). The only
 * thing changed here is the order products are counted in (Reorder, per category). Everything else about a product is on
 * its ingredient: a row opens the ingredient page with its Ordering group in view, which is also where a product is put on
 * this list or taken off it. The price is worked out from the ingredient (lib/ordering-facts.ts), never typed here. An old
 * item with no ingredient opens its small fallback card and says "Needs An Ingredient".
 */
export default function OrderingProductsPage() {
  const { venue, name, base } = useOrderingVenue();
  const { sb, data, status, error, apply, reload } = useVenueData(venue.id);
  const factsOf = useOrderFacts();
  const [cat, setCat] = useUrlState("cat", "");
  const [q, setQ] = useUrlState("q", "");
  const [showInactive, setShowInactive] = useUrlFlag("inactive");
  const [reorderId, setReorderId] = useUrlState("reorder", "");
  const [save, setSave] = useState<Save>({ state: "idle", message: null });

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

  /** a product is edited on its ingredient; an old item with no ingredient has a small card of its own */
  const rowLink = (p: OrderingProduct) => (p.ingredient_id ? ingredientOrderingHref(p.ingredient_id) : `${base}/setup/products/${p.id}`);
  const price = (p: OrderingProduct) => orderPriceShort(factsOf(p));
  const sub = (p: OrderingProduct) => `${productSub(p, supplierName, price(p))}${p.ingredient_id ? "" : ` · ${NEEDS_INGREDIENT}`}`;

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
                <span className="block text-[13px] text-label-2">{sub(p)}</span>
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
      <PageHeader title="Products" subtitle={`${name}'s order list, in shelf order`} className="lg:!pt-2" />
      {error && !data ? <Banner>{error}</Banner> : null}

      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-surface px-4 py-2">
        <p className="min-w-0 flex-1 basis-64 text-[15px] leading-snug text-label-2">
          A product is added, changed or taken off this list on its ingredient: switch {name} on under Ordering there. Tap a product to open it.
        </p>
        <TouchLink href="/ingredients" variant="tinted">
          Open Ingredients
        </TouchLink>
      </div>

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
          body={`Products sit in categories like Kegs or Spirits, and the count follows their order. Add ${name}'s categories, then switch ${name} on for each ingredient it orders.`}
          action={
            <TouchLink href={`${base}/setup/categories`} variant="primary">
              Add Categories
            </TouchLink>
          }
        />
      ) : status === "ready" && products.length === 0 ? (
        <Empty title={`${name} has no products yet`} body={`Open an ingredient and switch ${name} on under Ordering. It lands on this list straight away.`} />
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
              <Row key={p.id} href={rowLink(p)} title={<TitleWithTag name={p.name} active={p.active} />} sub={sub(p)} wrapSub trailing={<span className="text-[15px]">Build To {qtyText(p.par)}</span>} chevron className="!min-h-[64px]" />
            ))}
          </div>

          {/* desktop: a table */}
          <div className="hidden overflow-hidden rounded-2xl bg-surface xl:block">
            <table className="w-full table-fixed text-left text-[15px]">
              <colgroup>
                <col />
                <col className="w-[110px]" />
                <col className="w-[100px]" />
                <col className="w-[170px]" />
                <col className="w-[110px]" />
                <col className="w-[130px]" />
              </colgroup>
              <thead>
                <tr className="text-[13px] text-label-2">
                  <th scope="col" className="px-4 py-2.5 font-medium">Product</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Counted By</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Build To</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Supplier</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Item Code</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Price Inc GST</th>
                </tr>
              </thead>
              <tbody>
                {g.products.map((p) => {
                  const f = factsOf(p);
                  return (
                    <tr key={p.id} className="relative border-t border-[color:var(--separator)] hover:bg-fill">
                      <th scope="row" className="min-h-[56px] px-4 py-0 font-normal">
                        <Link href={rowLink(p)} className="flex min-h-[56px] items-center after:absolute after:inset-0 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--label)]">
                          <TitleWithTag name={p.name} active={p.active} />
                        </Link>
                      </th>
                      <td className="px-3 text-label-2">{unitTitle(p.unit_name)}</td>
                      <td className="px-3 text-right tnum">{qtyText(p.par)}</td>
                      <td className={cx("truncate px-3", p.supplier_id ? "text-label-2" : "text-label-3")}>{p.supplier_id ? supplierName.get(p.supplier_id) ?? "Removed" : "No supplier"}</td>
                      <td className="truncate px-3 tnum text-label-2">{f.code ?? ""}</td>
                      <td className={cx("px-4 text-right tnum", f.unitInc == null ? "text-[13px] text-warn" : "text-label-2")}>{f.needsIngredient && f.unitInc == null ? NEEDS_INGREDIENT : f.unitInc == null ? "No price" : `${orderPriceShort(f)}${f.needsIngredient ? " *" : ""}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {g.products.some((p) => !p.ingredient_id) ? <p className="border-t border-[color:var(--separator)] px-4 py-2 text-[13px] text-label-2">* An old price saved on the product. It needs an ingredient: open it to see how.</p> : null}
          </div>
        </section>
      ))}
    </div>
  );
}
