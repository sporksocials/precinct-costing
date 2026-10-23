"use client";

import { useState } from "react";
import { PACK_PRESETS, parsePacks } from "@/lib/invoice-questions-view";
import { cx } from "@/components/ui";
import { TouchButton } from "@/components/ordering/touch";

/**
 * "How many are in one carton?": shown only when the question is about the unit. Preset buttons (1, 6, 12, 24) fill the box,
 * a typed number works too, and Save Pack Size sends it. Nothing is sent until that last tap.
 */
export function PackHelper({ unit, onSave, disabled }: { unit: string | null | undefined; onSave: (packs: number) => void; disabled?: boolean }) {
  const [text, setText] = useState("");
  const packs = parsePacks(text);
  const word = unit?.trim() ? unit.trim().toLowerCase() : "unit";
  return (
    <div className="rounded-xl bg-surface-2 p-3">
      <p className="text-[15px] font-medium">How many are in one {word}?</p>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Common pack sizes">
        {PACK_PRESETS.map((n) => {
          const on = packs === n;
          return (
            <button
              key={n}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              onClick={() => setText(String(n))}
              className={cx(
                "min-h-[44px] min-w-[44px] rounded-full px-4 text-[17px] font-semibold transition active:scale-[0.97] disabled:opacity-40",
                on ? "bg-accent-fill text-accent-on" : "bg-fill text-label",
              )}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <label className="flex min-h-[48px] flex-1 items-center rounded-xl bg-fill px-3 focus-within:shadow-[inset_0_0_0_1.5px_var(--accent-fill)]">
          <span className="sr-only">Number in one {word}</span>
          <input
            inputMode="decimal"
            autoComplete="off"
            value={text}
            disabled={disabled}
            placeholder={`Or type a number`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && packs != null) onSave(packs);
            }}
            className="min-w-0 flex-1 bg-transparent py-3 text-[17px] text-label outline-none placeholder:text-label-3"
          />
        </label>
        <TouchButton variant="primary" disabled={disabled || packs == null} onClick={() => packs != null && onSave(packs)} className="sm:w-auto">
          Save Pack Size
        </TouchButton>
      </div>
      {text.trim() && packs == null ? (
        <p role="alert" className="mt-1.5 text-[13px] text-danger">
          Type a whole or decimal number above zero, such as 12.
        </p>
      ) : null}
    </div>
  );
}
