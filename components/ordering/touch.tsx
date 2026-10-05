"use client";

/**
 * Ordering screens: controls that are at least 44 x 44 CSS px at EVERY width and for every pointer type. The shared
 * primitives in components/ui.tsx shrink some controls at sm: and lg: (Segmented, Chips, InlineInput, AddButton, the Sheet
 * header buttons, .btn), which is right for a desk but wrong for Ordering, which is used on phones and tablets in a cold
 * room. Nothing here has a breakpoint that makes a tap target smaller. Gaps between neighbouring controls are 8px.
 */
import Link from "next/link";
import React, { useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, Plus, Search, X } from "lucide-react";
import { ACTIVE_LABEL } from "@/lib/active";
import { BackLink } from "@/components/back-link";
import { cx, Sheet } from "@/components/ui";

/* ---------------------------------------------------------------- buttons */

type Variant = "primary" | "plain" | "tinted" | "text" | "danger";
const VARIANT: Record<Variant, string> = {
  primary: "bg-accent-fill text-accent-on",
  plain: "bg-fill text-label",
  tinted: "bg-accent-soft text-accent",
  text: "text-accent",
  danger: "bg-danger-soft text-danger",
};
const BTN = "inline-flex min-h-[44px] min-w-[44px] select-none items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-center text-[17px] font-semibold transition active:scale-[0.98] active:opacity-80 disabled:pointer-events-none disabled:opacity-40";

export function TouchButton({ variant = "plain", className, ...rest }: { variant?: Variant } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...rest} className={cx(BTN, VARIANT[variant], variant === "text" && "px-2", className)} />;
}

export function TouchLink({ variant = "plain", className, href, children, ...rest }: { variant?: Variant; href: string; children: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <Link href={href} {...rest} className={cx(BTN, VARIANT[variant], variant === "text" && "px-2", className)}>
      {children}
    </Link>
  );
}

/** The one round add control at the top right of a screen: 44px, labelled on wide screens. */
export function TouchAddButton({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cx("inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-full bg-accent-fill px-3 text-[17px] font-semibold text-accent-on transition active:scale-95", className)}
    >
      <Plus className="h-5 w-5" strokeWidth={2.5} aria-hidden />
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}

/** The back arrow at the top of a screen: returns to the list as it was left (list memory), 44px high. */
export function TouchBack({ path, fallback, children }: { path: string; fallback: string; children: React.ReactNode }) {
  return (
    <BackLink path={path} fallback={fallback} className="-ml-1 inline-flex min-h-[44px] items-center gap-0 pr-3 text-[17px] text-accent">
      <ChevronLeft className="h-6 w-6" strokeWidth={2.25} aria-hidden />
      {children}
    </BackLink>
  );
}

/* ---------------------------------------------------------------- choices */

export function TouchSegmented<T extends string>({ options, value, onChange, className, ariaLabel }: { options: { value: T; label: React.ReactNode }[]; value: T; onChange: (v: T) => void; className?: string; ariaLabel?: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cx("flex gap-[2px] rounded-[12px] bg-fill p-[2px]", className)}>
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
              "min-h-[44px] flex-1 whitespace-nowrap rounded-[10px] px-3 text-[15px] font-medium transition-[background-color,box-shadow,color] duration-200 ease-ios",
              on ? "bg-elevated text-label shadow-[0_1px_3px_rgba(0,0,0,0.35),0_0_0_0.5px_rgba(255,255,255,0.04)]" : "text-label-2 hover:text-label",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Visible choice chips: scroll sideways on a phone when `wrap` is off, wrap onto more lines when it is on. Each is 44px high. */
export function TouchChips<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  wrap,
  className,
}: {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
  wrap?: boolean;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cx("flex gap-2", wrap ? "flex-wrap" : "no-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0", className)}>
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
              "min-h-[44px] shrink-0 whitespace-nowrap rounded-full px-4 text-[15px] font-medium transition-[background-color,color,transform] duration-200 ease-ios active:scale-[0.97]",
              on ? "bg-accent-fill text-accent-on" : "bg-surface text-label shadow-[inset_0_0_0_0.5px_var(--separator)] hover:bg-surface-2",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- inputs */

export function TouchSearch({ value, onChange, placeholder = "Search", label = "Search" }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string }) {
  return (
    <label className="relative flex items-center">
      <span className="sr-only">{label}</span>
      <Search className="pointer-events-none absolute left-3 h-[18px] w-[18px] text-label-2" strokeWidth={2.25} aria-hidden />
      <input
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-12 w-full rounded-xl bg-fill pl-10 pr-12 text-[17px] text-label outline-none placeholder:text-label-2 focus-visible:shadow-[inset_0_0_0_1.5px_var(--accent-fill)] [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button type="button" aria-label="Clear search" onClick={() => onChange("")} className="absolute right-0 flex h-11 w-11 items-center justify-center text-label-3">
          <span className="flex h-[20px] w-[20px] items-center justify-center rounded-full bg-[color:var(--label-3)] text-surface">
            <X className="h-3 w-3" strokeWidth={3} aria-hidden />
          </span>
        </button>
      ) : null}
    </label>
  );
}

/**
 * One labelled field: the label above, a 48px input below. It saves when the person leaves the field or presses Enter
 * (`onCommit` gets the typed text); Escape puts the old text back. An `error` is shown under the field in words.
 */
export function TextField({
  label,
  value,
  onCommit,
  onChangeText,
  placeholder,
  inputMode,
  type = "text",
  hint,
  error,
  prefix,
  suffix,
  multiline,
  autoFocus,
  className,
  name,
}: {
  label: string;
  value: string;
  onCommit: (text: string) => void;
  /** called on every keystroke (a Create button that needs the text before the field is left) */
  onChangeText?: (text: string) => void;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  type?: string;
  hint?: React.ReactNode;
  error?: string | null;
  prefix?: string;
  suffix?: React.ReactNode;
  multiline?: boolean;
  autoFocus?: boolean;
  className?: string;
  name?: string;
}) {
  const id = useId();
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  // text handed to onCommit and not yet reflected in `value`: keep showing it while the save is on its way
  const pending = useRef(false);
  useEffect(() => {
    pending.current = false;
    if (!focused) setText(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  useEffect(() => {
    if (!focused && !pending.current) setText(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);
  const shared = {
    id,
    name,
    value: text,
    placeholder,
    autoFocus,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error || hint ? `${id}-d` : undefined,
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      if (text !== value) {
        pending.current = true;
        onCommit(text);
      }
    },
    className: "min-w-0 flex-1 bg-transparent py-3 text-[17px] text-label outline-none placeholder:text-label-3",
  };
  return (
    <div className={cx("px-4 py-2.5", className)}>
      <label htmlFor={id} className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px] font-medium text-label-2">
        <span>{label}</span>
        {suffix ? <span className="font-normal">{suffix}</span> : null}
      </label>
      <div className={cx("flex min-h-[48px] items-center gap-1 rounded-xl bg-fill px-3 transition-shadow duration-150 focus-within:bg-surface-2 focus-within:shadow-[inset_0_0_0_1.5px_var(--accent-fill)]", error && "shadow-[inset_0_0_0_1.5px_var(--danger)]")}>
        {prefix ? <span className="text-[17px] text-label-2">{prefix}</span> : null}
        {multiline ? (
          <textarea
            {...shared}
            rows={3}
            onChange={(e) => {
              setText(e.target.value);
              onChangeText?.(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setText(value);
                (e.target as HTMLTextAreaElement).blur();
              }
            }}
            className={cx(shared.className, "min-h-[96px] resize-y")}
          />
        ) : (
          <input
            {...shared}
            type={type}
            inputMode={inputMode}
            autoComplete="off"
            autoCorrect="off"
            onChange={(e) => {
              setText(e.target.value);
              onChangeText?.(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setText(value);
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
        )}
      </div>
      {error ? (
        <p id={`${id}-d`} role="alert" className="mt-1.5 text-[13px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-d`} className="mt-1.5 text-[13px] text-label-2">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A labelled block inside a grouped list that holds a choice control (chips, segments) instead of text. */
export function ChoiceBlock({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <p className="mb-2 text-[13px] font-medium text-label-2">{label}</p>
      {children}
      {hint ? <p className="mt-2 text-[13px] text-label-2">{hint}</p> : null}
    </div>
  );
}

/** A whole-row on/off switch: the entire row is the 44px+ target, with the label and a sub line. */
export function SwitchRow({ checked, onChange, label, sub, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode; sub?: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-fill disabled:opacity-50"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[17px]">{label}</span>
        {sub ? <span className="mt-0.5 block text-[13px] text-label-2">{sub}</span> : null}
      </span>
      <span aria-hidden className={cx("relative inline-flex h-[31px] w-[51px] shrink-0 items-center rounded-full transition-colors duration-200", checked ? "bg-accent-fill" : "bg-fill-2")}>
        <span className={cx("inline-block h-[27px] w-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.16)] transition-transform duration-200 ease-ios", checked ? "translate-x-[22px]" : "translate-x-[2px]")} />
      </span>
    </button>
  );
}

/** The Active switch with the shared label. Off means hidden from counts and orders, never deleted. */
export function ActiveSwitch({ checked, onChange, sub }: { checked: boolean; onChange: (v: boolean) => void; sub: string }) {
  return <SwitchRow checked={checked} onChange={onChange} label={ACTIVE_LABEL} sub={sub} />;
}

/* ---------------------------------------------------------------- small pieces */

/** "Show Inactive (3)" / "Hide Inactive" as a 44px text button. */
export function TouchTextButton({ children, onClick, className, ariaLabel }: { children: React.ReactNode; onClick: () => void; className?: string; ariaLabel?: string }) {
  return (
    <button type="button" aria-label={ariaLabel} onClick={onClick} className={cx("inline-flex min-h-[44px] min-w-[44px] items-center justify-center px-2 text-[15px] font-medium text-accent active:opacity-60", className)}>
      {children}
    </button>
  );
}

/** Saved, saving or failed: one quiet line near the top of an editor. `aria-live` so it is read out. */
export function SaveNote({ state, message }: { state: "idle" | "saving" | "saved" | "error"; message?: string | null }) {
  if (state === "idle") return <p className="min-h-[20px]" aria-live="polite" />;
  return (
    <p className={cx("min-h-[20px] text-[13px]", state === "error" ? "text-danger" : "text-label-2")} aria-live="polite" role={state === "error" ? "alert" : undefined}>
      {state === "saving" ? "Saving..." : state === "saved" ? "Saved" : message || "That did not save."}
    </p>
  );
}

/** Small words-and-shape tag (never colour alone). */
export function Tag({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "accent" | "warn" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[12px] font-semibold leading-tight",
        tone === "accent" ? "bg-accent-soft text-accent" : tone === "warn" ? "bg-warn-soft text-warn" : "bg-fill text-label-2",
      )}
    >
      {children}
    </span>
  );
}

/**
 * A sheet with its own 44px header buttons (the shared Sheet header shrinks them on wide screens).
 * Cancel on the left, the title in the middle, the main action on the right.
 */
export function TouchSheet({
  open,
  onClose,
  title,
  action,
  cancelLabel = "Cancel",
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  action?: { label: string; onClick: () => void; disabled?: boolean };
  cancelLabel?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const headingId = useId();
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) first.current?.focus();
  }, [open]);
  return (
    <Sheet open={open} onClose={onClose} hideHeader size={size} labelledBy={headingId}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 pb-2">
        <div>
          <button ref={first} type="button" className="inline-flex min-h-[44px] min-w-[44px] items-center px-2 text-[17px] text-accent" onClick={onClose}>
            {cancelLabel}
          </button>
        </div>
        <h2 id={headingId} className="truncate px-1 text-center text-[17px] font-semibold">
          {title}
        </h2>
        <div className="flex justify-end">
          {action ? (
            <button type="button" className="inline-flex min-h-[44px] min-w-[44px] items-center justify-end px-2 text-[17px] font-semibold text-accent disabled:opacity-40" disabled={action.disabled} onClick={action.onClick}>
              {action.label}
            </button>
          ) : null}
        </div>
      </div>
      {children}
    </Sheet>
  );
}
