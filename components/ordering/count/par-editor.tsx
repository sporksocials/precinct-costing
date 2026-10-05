"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { cx } from "@/components/ui";
import { parseQtyText, sanitiseQtyText, unitPlural } from "@/lib/ordering-count-ui";
import type { OrderingProduct } from "@/lib/ordering-types";

/** Every tap target is 44 x 44 CSS px at every width (a rule of this app). */
const BTN = "inline-flex h-11 min-w-[44px] shrink-0 touch-manipulation select-none items-center justify-center rounded-xl px-3 text-[15px] font-semibold transition active:scale-95 active:opacity-80 disabled:opacity-40 motion-reduce:transition-none motion-reduce:active:scale-100";

/**
 * Change one product's Build To from the count screen (a busy week coming up). Saves to the product itself, so the order
 * screen and the next count use it; the change is recorded in the Change Log with the old value.
 */
export function ParEditor({ product, onSave, onClose }: { product: OrderingProduct; onSave: (product: OrderingProduct, par: number) => Promise<string | null>; onClose: () => void }) {
  const [text, setText] = useState(String(product.par));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const value = parseQtyText(text);
  const n = typeof value === "number" ? value : null;
  const changed = n != null && n !== product.par;

  const save = async () => {
    if (n == null) return;
    setSaving(true);
    setProblem(null);
    const message = await onSave(product, n);
    setSaving(false);
    if (message) setProblem(message);
    else onClose();
  };

  return (
    <div role="group" aria-label={`Change Build To for ${product.name}`} className="mt-3 rounded-xl bg-surface-2 p-3">
      <p className="text-[13px] text-label-2">How many {unitPlural(product.unit_name).toLowerCase()} should we build up to? It was {product.par}. It changes the order for every count from now on.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" aria-label="One fewer" disabled={saving || (n ?? 0) <= 0} onClick={() => setText(String(Math.max(0, (n ?? 0) - 1)))} className={cx(BTN, "bg-fill-2 text-label")}>
          <Minus className="h-5 w-5" strokeWidth={2.5} aria-hidden />
        </button>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          enterKeyHint="done"
          autoComplete="off"
          aria-label={`Build To for ${product.name}`}
          value={text}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setText(sanitiseQtyText(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
          }}
          className="h-11 w-[72px] touch-manipulation rounded-xl border border-transparent bg-fill text-center text-[20px] font-semibold text-label outline-none tnum focus:shadow-[0_0_0_2px_var(--accent-fill)]"
        />
        <button type="button" aria-label="One more" disabled={saving} onClick={() => setText(String((n ?? 0) + 1))} className={cx(BTN, "bg-fill-2 text-label")}>
          <Plus className="h-5 w-5" strokeWidth={2.5} aria-hidden />
        </button>
        <button type="button" disabled={saving || !changed} onClick={() => void save()} className={cx(BTN, "bg-accent-fill text-accent-on")}>
          {saving ? "Saving..." : "Save"}
        </button>
        <button type="button" disabled={saving} onClick={onClose} className={cx(BTN, "text-label-2")}>
          Cancel
        </button>
      </div>
      {n == null ? <p className="mt-2 text-[13px] font-medium text-warn">Type a whole number.</p> : null}
      {problem ? (
        <p role="alert" className="mt-2 text-[13px] font-medium text-warn">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
