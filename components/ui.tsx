"use client";

import Link from "next/link";
import React, { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Plus, Search, X } from "lucide-react";

export function cx(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(" ");
}

/* ---------------------------------------------------------------- page */

export function PageHeader({
  title,
  subtitle,
  trailing,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cx("flex items-end justify-between gap-3 pb-3 pt-3 lg:pt-8", className)}>
      <div className="min-w-0">
        <h1 className="display truncate pt-1 text-[40px] text-label lg:text-[44px]">{title}</h1>
        {subtitle ? <p className="mt-1.5 truncate text-[15px] text-label-2">{subtitle}</p> : null}
      </div>
      {trailing ? <div className="flex shrink-0 items-center gap-2 pb-1">{trailing}</div> : null}
    </header>
  );
}

/** The one "add" control: a round + at the top right of a screen (labelled on desktop). */
export function AddButton({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cx(
        "inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-full bg-accent-fill px-0 text-[15px] font-semibold text-accent-on transition active:scale-95 lg:px-4",
        className,
      )}
    >
      <Plus className="h-5 w-5" strokeWidth={2.5} />
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}

/* ---------------------------------------------------------------- grouped lists */

export function Group({
  title,
  footer,
  children,
  className,
  inset,
  trailing,
}: {
  title?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** left inset of separators, e.g. "3.25rem" when rows have leading icons */
  inset?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <section className={cx("mt-6", className)}>
      {title || trailing ? (
        <div className="flex items-end justify-between px-4 pb-1.5">
          <h2 className="text-[13px] font-medium text-label-2">{title}</h2>
          {trailing}
        </div>
      ) : null}
      <div className="group-list" style={inset ? ({ "--inset": inset } as React.CSSProperties) : undefined}>
        {children}
      </div>
      {footer ? <p className="px-4 pt-1.5 text-[13px] text-label-2">{footer}</p> : null}
    </section>
  );
}

export function Row({
  href,
  onClick,
  title,
  sub,
  leading,
  trailing,
  chevron,
  className,
  titleClassName,
  active,
  wrapSub,
}: {
  href?: string;
  onClick?: () => void;
  title: React.ReactNode;
  sub?: React.ReactNode;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  chevron?: boolean;
  className?: string;
  titleClassName?: string;
  active?: boolean;
  /** let the sub line wrap onto more lines instead of truncating (for reasons that must be read in full) */
  wrapSub?: boolean;
}) {
  const inner = (
    <>
      {leading ? <span className="flex shrink-0 items-center">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className={cx("block truncate text-[17px] leading-snug text-label sm:text-[15px]", titleClassName)}>{title}</span>
        {sub ? <span className={cx("mt-0.5 block text-[15px] leading-snug text-label-2 sm:text-[13px]", !wrapSub && "truncate")}>{sub}</span> : null}
      </span>
      {trailing != null ? <span className="flex shrink-0 items-center gap-1.5 text-[17px] tnum text-label-2 sm:text-[15px]">{trailing}</span> : null}
      {chevron ? <ChevronRight className="-mr-1 h-[18px] w-[18px] shrink-0 text-label-3" strokeWidth={2.5} aria-hidden /> : null}
    </>
  );
  const cls = cx(
    "flex min-h-[48px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150",
    (href || onClick) && "active:bg-fill hover:bg-[color:var(--fill)] lg:hover:bg-[color:var(--fill)]",
    active && "bg-fill",
    className,
  );
  if (href)
    return (
      <Link href={href} className={cls} onClick={onClick}>
        {inner}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" className={cls} onClick={onClick}>
        {inner}
      </button>
    );
  return <div className={cls}>{inner}</div>;
}

/* ---------------------------------------------------------------- controls */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  size = "md",
  ariaLabel,
}: {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  size?: "sm" | "md";
  ariaLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cx("flex rounded-[10px] bg-fill p-[2px]", className)}>
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
              "flex-1 whitespace-nowrap rounded-[8px] px-3 font-medium transition-[background-color,box-shadow,color] duration-200 ease-ios",
              size === "sm" ? "min-h-[30px] text-[13px]" : "min-h-[34px] text-[15px] sm:min-h-[30px] sm:text-[13px]",
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

export function Chips<T extends string>({
  options,
  value,
  onChange,
  className,
  ariaLabel,
}: {
  options: { value: T; label: React.ReactNode; className?: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cx("no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:-mx-0 sm:flex-wrap sm:px-0", className)}>
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
              "min-h-[40px] shrink-0 whitespace-nowrap rounded-full px-4 text-[15px] font-medium transition-[background-color,color,transform] duration-200 ease-ios active:scale-[0.97] sm:min-h-[34px] sm:px-3.5 sm:text-[14px]",
              on ? "bg-accent-fill text-accent-on" : "bg-surface text-label shadow-[inset_0_0_0_0.5px_var(--separator)] hover:bg-surface-2",
              o.className,
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder = "Search",
  autoFocus,
  inputRef,
  onKeyDown,
  className,
  onFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  className?: string;
  onFocus?: () => void;
}) {
  return (
    <label className={cx("relative flex items-center", className)}>
      <Search className="pointer-events-none absolute left-2.5 h-[18px] w-[18px] text-label-2" strokeWidth={2.25} aria-hidden />
      <input
        ref={inputRef}
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        className="h-11 w-full rounded-xl bg-fill pl-9 pr-9 text-[17px] text-label outline-none placeholder:text-label-2 sm:h-9 sm:text-[15px] [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button type="button" aria-label="Clear" onClick={() => onChange("")} className="absolute right-1 flex h-9 w-9 items-center justify-center text-label-3 sm:h-7 sm:w-7">
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[color:var(--label-3)] text-surface">
            <X className="h-3 w-3" strokeWidth={3} />
          </span>
        </button>
      ) : null}
    </label>
  );
}

export function Toggle({ checked, onChange, label, sub }: { checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; sub?: React.ReactNode }) {
  const id = useId();
  const sw = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cx("relative inline-flex h-[31px] w-[51px] shrink-0 items-center rounded-full transition-colors duration-200", checked ? "bg-accent-fill" : "bg-fill-2")}
    >
      <span className={cx("inline-block h-[27px] w-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.16)] transition-transform duration-200 ease-ios", checked ? "translate-x-[22px]" : "translate-x-[2px]")} />
    </button>
  );
  if (!label) return sw;
  return (
    <div className="flex min-h-[44px] items-center gap-3 px-4 py-1.5">
      <label htmlFor={id} className="min-w-0 flex-1">
        <span className="block text-[17px] sm:text-[15px]">{label}</span>
        {sub ? <span className="block text-[13px] text-label-2">{sub}</span> : null}
      </label>
      {sw}
    </div>
  );
}

export function Stepper({ value, onChange, min = 1, step = 1, format }: { value: number; onChange: (v: number) => void; min?: number; step?: number; format?: (v: number) => string }) {
  return (
    <div className="inline-flex items-center rounded-full bg-fill">
      <button type="button" aria-label="Decrease" className="flex h-9 w-10 items-center justify-center text-[20px] font-medium text-label disabled:opacity-30" disabled={value - step < min} onClick={() => onChange(Math.max(min, Math.round((value - step) * 1000) / 1000))}>
        −
      </button>
      <span className="min-w-[1.75rem] text-center text-[15px] font-semibold tnum">{format ? format(value) : value}</span>
      <button type="button" aria-label="Increase" className="flex h-9 w-10 items-center justify-center text-[20px] font-medium text-label" onClick={() => onChange(Math.round((value + step) * 1000) / 1000)}>
        +
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- sheets */

function useLockScroll(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}

/**
 * Bottom sheet on phones, centred dialog on larger screens.
 * iOS-style header: Cancel · Title · Action.
 */
export function Sheet({
  open,
  onClose,
  title,
  action,
  cancelLabel = "Cancel",
  children,
  size = "md",
  hideHeader,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  action?: { label: string; onClick: () => void; disabled?: boolean; destructive?: boolean };
  cancelLabel?: string | null;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg";
  hideHeader?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useLockScroll(open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open || !mounted) return null;
  const width = size === "sm" ? "sm:max-w-sm" : size === "lg" ? "sm:max-w-2xl" : "sm:max-w-md";
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true">
      <div className="anim-fade absolute inset-0 bg-[color:var(--scrim)]" onClick={onClose} />
      <div
        className={cx(
          "sheet anim-sheet relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[14px] shadow-float sm:max-h-[85vh] sm:rounded-2xl sm:[animation-name:pop-in]",
          width,
        )}
      >
        <div className="mx-auto mt-1.5 h-[5px] w-9 shrink-0 rounded-full bg-fill-2 sm:hidden" aria-hidden />
        {!hideHeader ? (
          <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center px-2 pb-1 pt-1.5 sm:pt-2.5">
            <div>
              {cancelLabel ? (
                <button type="button" className="btn-text px-2" onClick={onClose}>
                  {cancelLabel}
                </button>
              ) : null}
            </div>
            <h2 className="truncate px-2 text-center text-[17px] font-semibold sm:text-[15px]">{title}</h2>
            <div className="flex justify-end">
              {action ? (
                <button
                  type="button"
                  className={cx("btn-text px-2 font-semibold disabled:opacity-40", action.destructive && "!text-danger")}
                  disabled={action.disabled}
                  onClick={action.onClick}
                >
                  {action.label}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-1">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** Small anchored popover menu ("…" menus, sort). */
export function Menu({
  trigger,
  items,
  align = "right",
  label,
}: {
  trigger: React.ReactNode;
  items: ({ label: React.ReactNode; onClick: () => void; destructive?: boolean; checked?: boolean; icon?: React.ReactNode } | "sep")[];
  align?: "left" | "right";
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-h-[44px] min-w-[44px] items-center justify-center text-accent sm:min-h-[36px] sm:min-w-[36px]">
        {trigger}
      </button>
      {open ? (
        <div role="menu" className={cx("anim-pop absolute top-full z-[60] mt-1 min-w-[220px] overflow-hidden rounded-[14px] bg-elevated py-1 shadow-float", align === "right" ? "right-0" : "left-0")}>
          {items.map((it, i) =>
            it === "sep" ? (
              <div key={i} className="my-1 h-[6px] bg-fill" />
            ) : (
              <button
                key={i}
                role="menuitem"
                type="button"
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
                className={cx("flex min-h-[44px] w-full items-center justify-between gap-6 px-4 text-left text-[17px] active:bg-fill sm:min-h-[36px] sm:text-[15px] sm:hover:bg-fill", it.destructive ? "text-danger" : "text-label")}
              >
                <span className="flex items-center gap-2">
                  <span className="w-4 text-accent">{it.checked ? "✓" : null}</span>
                  {it.label}
                </span>
                {it.icon ? <span className="text-label-2">{it.icon}</span> : null}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- feedback */

interface ToastMsg {
  id: number;
  message: string;
  action?: { label: string; onClick: () => void };
}
const ToastCtx = createContext<{ show: (m: Omit<ToastMsg, "id">, ms?: number) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastMsg | null>(null);
  const timer = useRef<number>();
  const show = useCallback((m: Omit<ToastMsg, "id">, ms = 5000) => {
    window.clearTimeout(timer.current);
    setToast({ ...m, id: Date.now() });
    timer.current = window.setTimeout(() => setToast(null), ms);
  }, []);
  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(96px+env(safe-area-inset-bottom))] z-[80] flex justify-center px-4 lg:bottom-8">
          <div key={toast.id} role="status" className="anim-pop pointer-events-auto flex max-w-md items-center gap-4 rounded-2xl bg-[#2c2c31] py-2.5 pl-4 pr-2 text-[15px] text-label shadow-float">
            <span className="min-w-0 truncate">{toast.message}</span>
            {toast.action ? (
              <button
                type="button"
                className="min-h-[36px] shrink-0 rounded-lg px-3 font-semibold text-accent"
                onClick={() => {
                  toast.action?.onClick();
                  setToast(null);
                }}
              >
                {toast.action.label}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast outside ToastProvider");
  return ctx;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-lg bg-fill", className)} />;
}

export function ListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="group-list mt-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-4 w-12" />
        </div>
      ))}
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <p className="text-[20px] font-semibold">{title}</p>
      {body ? <p className="mt-1.5 max-w-xs text-[15px] text-label-2">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Banner({ children, action, tone = "danger" }: { children: React.ReactNode; action?: React.ReactNode; tone?: "danger" | "neutral" }) {
  return (
    <div className={cx("mt-3 flex items-center gap-3 rounded-2xl px-4 py-2.5 text-[15px]", tone === "danger" ? "bg-danger-soft text-danger" : "bg-fill text-label-2")}>
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}

export function Disclosure({ title, hint, children, defaultOpen }: { title: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <section className="mt-6">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cx("flex min-h-[52px] w-full items-center gap-3 bg-surface px-4 text-left transition-[border-radius,background-color] duration-200 hover:bg-surface-2", open ? "rounded-t-2xl" : "rounded-2xl")}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] font-medium sm:text-[15px]">{title}</span>
          {hint && !open ? <span className="mt-0.5 block truncate text-[13px] text-label-2">{hint}</span> : null}
        </span>
        <ChevronRight className={cx("h-[18px] w-[18px] shrink-0 text-label-3 transition-transform duration-200 ease-ios", open && "rotate-90")} strokeWidth={2.5} />
      </button>
      {open ? <div className="anim-fade [&>.group-list]:rounded-t-none [&>.group-list]:shadow-[inset_0_0.5px_0_var(--separator)]">{children}</div> : null}
    </section>
  );
}

/** Labelled field row inside a grouped list: label left, control right. */
export function FieldRow({ label, children, sub }: { label: React.ReactNode; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex min-h-[44px] items-center gap-3 px-4 py-1.5">
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] sm:text-[15px]">{label}</span>
        {sub ? <span className="block text-[13px] text-label-2">{sub}</span> : null}
      </span>
      <span className="flex shrink-0 items-center">{children}</span>
    </div>
  );
}

/** Right-aligned inline input for FieldRow (commits on blur / Enter). */
export function InlineInput({
  value,
  onCommit,
  placeholder,
  inputMode = "decimal",
  prefix,
  suffix,
  width = "w-24",
  align = "right",
  type = "text",
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  prefix?: string;
  suffix?: string;
  width?: string;
  align?: "left" | "right";
  type?: string;
}) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value);
  }, [value, focused]);
  return (
    <span
      className={cx(
        "flex min-h-[36px] items-center justify-end gap-0.5 rounded-lg bg-fill px-2.5 text-[17px] text-label-2 transition-shadow duration-150 focus-within:bg-surface-2 focus-within:shadow-[inset_0_0_0_1.5px_var(--accent-fill)] sm:min-h-[32px] sm:text-[15px]",
        width,
      )}
    >
      {prefix ? <span>{prefix}</span> : null}
      <input
        type={type}
        inputMode={inputMode}
        value={text}
        placeholder={placeholder}
        onFocus={(e) => {
          setFocused(true);
          e.currentTarget.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setFocused(false);
          if (text !== value) onCommit(text);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setText(value);
            (e.target as HTMLInputElement).blur();
          }
        }}
        style={{ width: `${Math.max(text.length, (placeholder ?? "").length, 2) + 0.4}ch` }}
        className={cx("min-w-0 max-w-full bg-transparent tnum text-label outline-none", align === "right" ? "text-right" : "text-left")}
      />
      {suffix ? <span>{suffix}</span> : null}
    </span>
  );
}

export function Dot({ className }: { className?: string }) {
  return <span aria-hidden className={cx("inline-block h-2 w-2 shrink-0 rounded-full", className)} />;
}
