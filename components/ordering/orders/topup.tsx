"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { OrderingProduct, OrderingSupplier, SuggestedLine } from "@/lib/ordering-types";
import type { Venue } from "@/lib/types";
import { OrderCard } from "./order-card";
import { ChoiceChips, btnPlain } from "./parts";

const NO_SUGGESTIONS: ReadonlyMap<string, SuggestedLine> = new Map();

/**
 * New Top-Up Order: a quick order that is not tied to a count. Pick a supplier, add products with typed quantities (or a
 * typed name), send it the same way as any other order. Saved with kind top_up and no count.
 */
export function TopUpPanel({
  venue,
  suppliers,
  products,
  senderName,
  userEmail,
  nameOf,
  onSaved,
  onClose,
}: {
  venue: Venue;
  suppliers: readonly OrderingSupplier[];
  products: readonly OrderingProduct[];
  senderName: string | null;
  userEmail: string | null;
  nameOf: (email: string | null | undefined) => string | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const active = useMemo(() => suppliers.filter((s) => s.active).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)), [suppliers]);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const supplier = active.find((s) => s.id === supplierId) ?? null;
  return (
    <section aria-label="New top-up order" className="mt-4 rounded-2xl bg-surface-2 p-4 shadow-[inset_0_0_0_1.5px_var(--accent-fill)]">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-semibold text-label">New Top-Up Order</h2>
          <p className="mt-0.5 text-[14px] text-label-2">A quick order with typed quantities. It is not tied to a count.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close the top-up order" className={`${btnPlain} !px-0`}>
          <X aria-hidden className="h-5 w-5" strokeWidth={2.25} />
        </button>
      </div>
      <p className="mb-2 mt-3 text-[13px] font-medium text-label-2">Supplier</p>
      {active.length ? <ChoiceChips label="Supplier for this top-up order" options={active.map((s) => ({ value: s.id, label: s.name }))} value={supplierId} onChange={(id) => { setSupplierId(id); setNonce((n) => n + 1); }} /> : <p className="text-[15px] text-label-2">No suppliers are set up for this venue yet.</p>}
      {supplier ? (
        <div className="mt-4">
          <OrderCard
            key={`${supplier.id}:${nonce}`}
            venue={venue}
            supplier={supplier}
            products={products}
            suppliers={suppliers}
            suggestions={NO_SUGGESTIONS}
            initialLines={[]}
            notNeeded={[]}
            uncounted={[]}
            kind="top_up"
            sessionId={null}
            scope="venue"
            sent={[]}
            senderName={senderName}
            userEmail={userEmail}
            nameOf={nameOf}
            startOpen
            onSaved={onSaved}
            onAnother={() => setNonce((n) => n + 1)}
          />
        </div>
      ) : null}
    </section>
  );
}
