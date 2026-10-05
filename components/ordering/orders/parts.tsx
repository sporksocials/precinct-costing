"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Minus, Plus, X } from "lucide-react";
import { cx } from "@/components/ui";
import { parseQty, stepQty, type DraftLine } from "@/lib/ordering-orders-ui";

/*
 * Small pieces for the Order screens. Every control is at least 44 by 44 CSS px at every width and for every pointer
 * (this app's hard rule: no sm: or lg: shrinking), with 8px gaps. Colour is never the only signal: warnings and sent
 * states carry an icon and words. The app-wide .btn classes shrink at sm, so these screens use their own.
 */

const base =
  "inline-flex min-h-[44px] min-w-[44px] select-none items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-semibold leading-tight transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--label)] disabled:opacity-40 aria-disabled:opacity-40";
export const btnPrimary = `${base} bg-accent-fill text-accent-on hover:opacity-90`;
export const btnPlain = `${base} bg-fill text-label hover:bg-[color:var(--fill-2)]`;
export const btnTinted = `${base} bg-accent-soft text-accent hover:opacity-90`;
export const btnText =
  "inline-flex min-h-[44px] min-w-[44px] items-center gap-1.5 rounded-lg px-2 text-[15px] font-medium text-accent hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--label)]";
export const fieldBox =
  "h-11 min-h-[44px] w-full rounded-xl bg-fill px-3.5 text-[16px] text-label outline-none placeholder:text-label-2 focus:bg-surface-2 focus:shadow-[inset_0_0_0_1.5px_var(--accent-fill)]";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** True when the element is at least `min` px wide: switches a card between its table and its stacked rows. */
export function useWide<T extends HTMLElement>(min: number): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [wide, setWide] = useState(false);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWide(el.getBoundingClientRect().width >= min);
    measure();
    window.addEventListener("resize", measure);
    if (typeof ResizeObserver === "undefined") return () => window.removeEventListener("resize", measure);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [min]);
  return [ref, wide];
}

/** A warning or helper with an icon and words (colour backs it up, never carries it alone). */
export function Notice({ tone = "warn", children, className, role }: { tone?: "warn" | "neutral" | "danger" | "good"; children: React.ReactNode; className?: string; role?: "status" | "alert" }) {
  const Icon = tone === "good" ? Check : AlertTriangle;
  return (
    <div role={role} className={cx("flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-[15px] leading-snug", tone === "warn" && "bg-warn-soft text-label", tone === "danger" && "bg-danger-soft text-label", tone === "good" && "bg-good-soft text-label", tone === "neutral" && "bg-fill text-label-2", className)}>
      {tone !== "neutral" ? <Icon aria-hidden className={cx("mt-0.5 h-[18px] w-[18px] shrink-0", tone === "warn" && "text-warn", tone === "danger" && "text-danger", tone === "good" && "text-good")} strokeWidth={2.5} /> : null}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Whole-number field with plus and minus: 44 px buttons, an input that takes typing. Steps by the pack multiple. */
export function QtyControl({ line, onChange }: { line: Pick<DraftLine, "qty" | "packMultiple" | "name">; onChange: (qty: number) => void }) {
  const [text, setText] = useState(String(line.qty));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(line.qty));
  }, [line.qty, focused]);
  return (
    <div className="inline-flex items-center gap-2">
      <button type="button" aria-label={`Fewer ${line.name}`} disabled={line.qty <= 0} onClick={() => onChange(stepQty(line, -1))} className="flex h-11 w-11 items-center justify-center rounded-xl bg-fill text-label transition-colors hover:bg-[color:var(--fill-2)] disabled:opacity-30 motion-reduce:transition-none">
        <Minus aria-hidden className="h-5 w-5" strokeWidth={2.5} />
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        aria-label={`Order quantity for ${line.name}`}
        value={text}
        onFocus={(e) => {
          setFocused(true);
          e.currentTarget.select();
        }}
        onChange={(e) => {
          const t = e.target.value.replace(/\D/g, "").slice(0, 4);
          setText(t);
          const n = parseQty(t);
          if (n != null) onChange(n);
        }}
        onBlur={() => {
          setFocused(false);
          setText(String(line.qty));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="h-11 w-[68px] rounded-xl bg-fill text-center text-[16px] font-semibold tnum text-label outline-none focus:bg-surface-2 focus:shadow-[inset_0_0_0_1.5px_var(--accent-fill)]"
      />
      <button type="button" aria-label={`More ${line.name}`} onClick={() => onChange(stepQty(line, 1))} className="flex h-11 w-11 items-center justify-center rounded-xl bg-fill text-label transition-colors hover:bg-[color:var(--fill-2)] motion-reduce:transition-none">
        <Plus aria-hidden className="h-5 w-5" strokeWidth={2.5} />
      </button>
    </div>
  );
}

export function RemoveButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={`Remove ${name} from this order`} onClick={onClick} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-label-2 transition-colors hover:bg-fill hover:text-label motion-reduce:transition-none">
      <X aria-hidden className="h-5 w-5" strokeWidth={2.25} />
    </button>
  );
}

/** A switch with a 44 px high tap area (the shared Toggle is 31 px). */
export function SwitchRow({ checked, onChange, label, sub }: { checked: boolean; onChange: (v: boolean) => void; label: string; sub?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex min-h-[44px] w-full items-center gap-3 rounded-xl py-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--label)]">
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium text-label">{label}</span>
        {sub ? <span className="block text-[13px] text-label-2">{sub}</span> : null}
      </span>
      <span aria-hidden className={cx("relative inline-flex h-[31px] w-[51px] shrink-0 items-center rounded-full transition-colors duration-200 motion-reduce:transition-none", checked ? "bg-accent-fill" : "bg-fill-2")}>
        <span className={cx("inline-block h-[27px] w-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15)] transition-transform duration-200 motion-reduce:transition-none", checked ? "translate-x-[22px]" : "translate-x-[2px]")} />
      </span>
      <span className="w-6 text-[13px] font-semibold text-label-2">{checked ? "On" : "Off"}</span>
    </button>
  );
}

/** A choice made of visible 44 px chips (no hidden dropdown). */
export function ChoiceChips<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T | null; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cx(
              "inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-[15px] font-medium transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--label)]",
              on ? "bg-accent-fill text-accent-on" : "bg-fill text-label hover:bg-[color:var(--fill-2)]",
            )}
          >
            {on ? <Check aria-hidden className="h-4 w-4" strokeWidth={3} /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A status word with an icon: Sent, Not Sent. */
export function StatusPill({ sent, children }: { sent: boolean; children?: React.ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-semibold", sent ? "bg-good-soft text-good" : "bg-warn-soft text-warn")}>
      {sent ? <Check aria-hidden className="h-3.5 w-3.5" strokeWidth={3} /> : <AlertTriangle aria-hidden className="h-3.5 w-3.5" strokeWidth={2.5} />}
      {children ?? (sent ? "Sent" : "Not Sent")}
    </span>
  );
}
