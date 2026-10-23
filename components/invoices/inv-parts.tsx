"use client";

import { AlertTriangle, ArrowDown, ArrowUp, Ban, Check, Copy, Minus, X } from "lucide-react";
import { cx } from "@/components/ui";
import type { PriceMove, StatusIcon, StatusView } from "@/lib/invoice-view";

const ICON: Record<StatusIcon, typeof Check> = { check: Check, alert: AlertTriangle, dash: Minus, copy: Copy, x: X, ban: Ban };

/** A status as icon plus words. Amber (the existing warn token) only when it waits on a person, red only when it could not be read. */
export function StatusLabel({ view, className }: { view: StatusView; className?: string }) {
  const Icon = ICON[view.icon];
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-[15px] font-medium sm:text-[13px]", view.tone === "warn" ? "text-warn" : view.tone === "danger" ? "text-danger" : "text-label-2", className)}>
      <Icon aria-hidden className="h-4 w-4 shrink-0" strokeWidth={2.5} />
      <span>{view.word}</span>
    </span>
  );
}

/** "Up 2.8%" with an arrow, in plain text colour: a price move is information, not a warning. */
export function MoveLabel({ move, className }: { move: PriceMove; className?: string }) {
  if (move.dir === "none") return null;
  const Icon = move.dir === "up" ? ArrowUp : move.dir === "down" ? ArrowDown : Minus;
  return (
    <span className={cx("inline-flex items-center gap-1 text-[15px] font-medium text-label sm:text-[13px]", className)}>
      <Icon aria-hidden className="h-4 w-4 shrink-0" strokeWidth={2.5} />
      <span>{move.text}</span>
    </span>
  );
}

/** The amber "needs a person" word, always with its icon. */
export function NeedsTag({ children = "Needs approval" }: { children?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-warn-soft px-2 py-0.5 text-[13px] font-semibold text-warn">
      <AlertTriangle aria-hidden className="h-3.5 w-3.5" strokeWidth={2.5} />
      {children}
    </span>
  );
}
