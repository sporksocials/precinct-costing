"use client";

import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { qtyText } from "@/lib/ordering";
import { addCandidates, countSummary, type DraftLine } from "@/lib/ordering-orders-ui";
import type { OrderingProduct, OrderingSupplier, SuggestedLine } from "@/lib/ordering-types";
import { btnPlain, fieldBox } from "./parts";

/**
 * Add Product: a search among the products that can go on this order, plus a typed option for something that is not on the
 * list. A count card searches its own supplier's products; a top-up searches the whole venue (its supplier's first).
 */
export function AddProduct({
  products,
  supplierId,
  scope,
  onOrder,
  suggestions,
  suppliers,
  onAddProduct,
  onAddTyped,
  onClose,
}: {
  products: readonly OrderingProduct[];
  supplierId: string | null;
  scope: "supplier" | "venue";
  onOrder: readonly DraftLine[];
  suggestions: ReadonlyMap<string, SuggestedLine>;
  suppliers: readonly OrderingSupplier[];
  onAddProduct: (product: OrderingProduct, suggested: SuggestedLine | null) => void;
  onAddTyped: (name: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const supplierName = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);
  const found = useMemo(() => addCandidates(products, { supplierId, scope, onOrder, query, suggestions }), [products, supplierId, scope, onOrder, query, suggestions]);
  const typed = query.trim();
  return (
    <div className="border-t border-[color:var(--separator)] bg-fill px-4 py-3">
      <label className="relative block">
        <span className="sr-only">Search products or type a name</span>
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-label-2" strokeWidth={2.25} />
        <input type="search" autoComplete="off" autoCorrect="off" spellCheck={false} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search products or type a name" className={`${fieldBox} pl-10 !bg-surface [&::-webkit-search-cancel-button]:hidden`} />
      </label>
      <ul className="mt-2 max-h-72 overflow-y-auto overscroll-contain rounded-xl bg-surface" aria-label="Products you can add">
        {found.length === 0 ? <li className="px-4 py-3 text-[15px] text-label-2">{typed ? "No product matches. You can add it as a typed line." : "Every product is already on this order."}</li> : null}
        {found.map((c) => {
          const other = c.otherSupplierId ? supplierName.get(c.otherSupplierId) ?? "Another supplier" : c.product.supplier_id == null && scope === "venue" ? "No supplier" : null;
          // a top-up has no count, so there is nothing to say about one
          const hint = c.suggested ? (c.suggested.suggestion.orderQty > 0 ? `Suggested ${qtyText(c.suggested.suggestion.orderQty)}` : countSummary(c.suggested)) : suggestions.size > 0 ? "Not counted" : null;
          return (
            <li key={c.product.id} className="border-t border-[color:var(--separator)] first:border-t-0">
              <button type="button" onClick={() => onAddProduct(c.product, c.suggested)} className="flex min-h-[48px] w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-fill motion-reduce:transition-none">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] text-label">{c.product.name}</span>
                  <span className="block truncate text-[13px] text-label-2">
                    {c.product.unit_name}
                    {other ? ` · ${other}` : ""}
                    {hint ? ` · ${hint}` : ""}
                  </span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-[15px] font-semibold text-accent">
                  <Plus aria-hidden className="h-4 w-4" strokeWidth={3} />
                  Add
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {typed ? (
          <button type="button" onClick={() => { onAddTyped(typed); setQuery(""); }} className={btnPlain}>
            <Plus aria-hidden className="h-4 w-4" strokeWidth={3} />
            Add &ldquo;{typed.length > 28 ? `${typed.slice(0, 28)}...` : typed}&rdquo; As A Typed Line
          </button>
        ) : (
          <p className="text-[13px] text-label-2">Type a name to add something that is not on the list.</p>
        )}
        <button type="button" onClick={onClose} className={`${btnPlain} ml-auto`}>
          Done
        </button>
      </div>
    </div>
  );
}
