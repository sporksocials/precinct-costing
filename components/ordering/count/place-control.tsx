"use client";

import { memo, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { cx } from "@/components/ui";
import { parseQtyText, placeState, qtyBoxText, sanitiseQtyText, stepQty } from "@/lib/ordering-count-ui";

/** Every tap target here is 44 x 44 CSS px at every width and for every pointer (a rule of this app: no sm: or lg: shrinking). Gaps are 8px. */
const BTN = "inline-flex h-11 w-11 shrink-0 touch-manipulation select-none items-center justify-center rounded-xl transition active:scale-95 active:opacity-80 disabled:opacity-30 motion-reduce:transition-none motion-reduce:active:scale-100";

/**
 * One counting place (Store, or the category's second place): [Zero or minus] [number box] [plus].
 *   not counted   the box shows a dash and the left button reads Zero (a zero is a deliberate tap, never a default)
 *   counted       minus and plus step by one; the box can be tapped and typed into
 *   zero          shows 0; minus is off; clearing the box (empty, then leave it) goes back to not counted
 * Quantities are whole numbers. The box asks for the number keypad and keeps digits only.
 */
export const PlaceControl = memo(function PlaceControl({ label, productName, value, onChange }: { label: string; productName: string; value: number | null; onChange: (v: number | null) => void }) {
  const state = placeState(value);
  const [draft, setDraft] = useState<string | null>(null); // the text while the box has focus
  const text = draft ?? qtyBoxText(value);
  const spoken = `${label} count for ${productName}`;

  return (
    <div role="group" aria-label={spoken} className="min-w-0 flex-1 sm:flex-none">
      <p className="mb-1 text-[12px] font-medium uppercase tracking-wide text-label-2">{label}</p>
      <div className="flex items-center gap-2">
        {state === "untouched" ? (
          <button type="button" aria-label={`Count ${spoken.toLowerCase()} as zero`} onClick={() => onChange(0)} className={cx(BTN, "border border-[color:var(--label-3)] text-[13px] font-semibold text-label")}>
            Zero
          </button>
        ) : (
          <button type="button" aria-label={`One fewer. ${spoken}`} disabled={state === "zero"} onClick={() => onChange(stepQty(value, -1))} className={cx(BTN, "bg-fill-2 text-label")}>
            <Minus className="h-5 w-5" strokeWidth={2.5} aria-hidden />
          </button>
        )}
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          enterKeyHint="done"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label={state === "untouched" ? `${spoken}. Not counted` : spoken}
          placeholder="-"
          value={text}
          onFocus={(e) => {
            setDraft(qtyBoxText(value));
            const el = e.currentTarget;
            window.setTimeout(() => el.select(), 0);
          }}
          onChange={(e) => {
            const t = sanitiseQtyText(e.target.value);
            setDraft(t);
            const n = parseQtyText(t);
            if (t !== "" && typeof n === "number") onChange(n); // saved as it is typed; emptying the box is only applied when the person leaves it
          }}
          onBlur={() => {
            if (draft === "" && value != null) onChange(null);
            setDraft(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className={cx(
            "h-11 min-w-[44px] max-w-[88px] flex-1 touch-manipulation rounded-xl text-center text-[20px] font-semibold text-label outline-none tnum transition-shadow placeholder:text-label-3 focus:shadow-[0_0_0_2px_var(--accent-fill)] sm:w-[64px] sm:flex-none",
            state === "untouched" ? "border border-dashed border-[color:var(--label-3)] bg-transparent" : "border border-transparent bg-surface-2",
          )}
        />
        <button type="button" aria-label={`One more. ${spoken}`} onClick={() => onChange(stepQty(value, 1))} className={cx(BTN, "bg-fill-2 text-label")}>
          <Plus className="h-5 w-5" strokeWidth={2.5} aria-hidden />
        </button>
      </div>
    </div>
  );
});
