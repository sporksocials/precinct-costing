"use client";

import { ListChecks } from "lucide-react";

/**
 * The Select control that starts picking recipes to print. Self-contained: it renders only the button (44px at every width),
 * takes its state through props, and shows nothing while picking has started (the bar at the bottom has Cancel).
 */
export function SelectButton({ active, onStart, className }: { active: boolean; onStart: () => void; className?: string }) {
  if (active) return null;
  return (
    <button type="button" onClick={onStart} className={["inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-xl px-3 text-[15px] font-semibold text-accent transition active:opacity-70", className].filter(Boolean).join(" ")}>
      <ListChecks className="h-[18px] w-[18px]" strokeWidth={2.25} aria-hidden />
      Select
    </button>
  );
}

/**
 * The top-of-list controls for Select mode. Before picking: "Select". While picking: "Select All" (or "Clear All" once every
 * row shown is ticked) and "Cancel", so a whole list is one tap away without scrolling to the bar at the bottom.
 */
export function SelectControls({ sel, className }: { sel: { on: boolean; start: () => void; cancel: () => void; selectAllShown: () => void; allShownTicked: boolean }; className?: string }) {
  if (!sel.on) return <SelectButton active={false} onStart={sel.start} className={className} />;
  const base = "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-fill px-3.5 text-[15px] font-semibold text-label transition active:opacity-70";
  return (
    <>
      <button type="button" onClick={sel.selectAllShown} className={[base, className].filter(Boolean).join(" ")}>
        {sel.allShownTicked ? "Clear All" : "Select All"}
      </button>
      <button type="button" onClick={sel.cancel} className={[base, className].filter(Boolean).join(" ")}>
        Cancel
      </button>
    </>
  );
}
