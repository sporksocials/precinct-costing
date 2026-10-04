"use client";

import { Check } from "lucide-react";
import { cx, Sheet } from "./ui";

/**
 * Save bar for pages that hold a draft and save it on a button (recipe editor, offer builder).
 * One glance tells you whether the page is saved: "All Changes Saved" in quiet text, or "Unsaved Changes" with
 * Discard and Save. The caller places it (docked above the phone summary bar, or sticky on desktop).
 */
export type SaveState = "saved" | "dirty" | "saving" | "error";

export function SaveBar({
  state,
  onSave,
  onDiscard,
  saveLabel = "Save",
  className,
}: {
  state: SaveState;
  onSave: () => void;
  /** asks to discard (the caller shows `DiscardSheet`) */
  onDiscard: () => void;
  saveLabel?: string;
  className?: string;
}) {
  const busy = state === "saving";
  return (
    <div className={cx("flex items-center gap-3", className)} role="region" aria-label="Save Changes">
      <div className="min-w-0 flex-1 text-[15px]" aria-live="polite">
        {state === "saved" ? (
          <span className="flex items-center gap-1.5 text-label-2">
            <Check className="h-4 w-4 shrink-0 text-good" strokeWidth={2.5} aria-hidden />
            <span className="truncate">All Changes Saved</span>
          </span>
        ) : state === "saving" ? (
          <span className="text-label-2">Saving…</span>
        ) : state === "error" ? (
          <span className="flex items-center gap-2 font-semibold text-danger">
            <span className="h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
            <span className="truncate">Not Saved</span>
          </span>
        ) : (
          <span className="flex items-center gap-2 font-semibold">
            <span className="h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
            <span className="truncate">Unsaved Changes</span>
          </span>
        )}
      </div>
      {state === "dirty" || state === "error" ? (
        <button type="button" className="btn-plain !min-h-[40px] !px-4 !text-[15px]" onClick={onDiscard}>
          Discard
        </button>
      ) : null}
      <button type="button" className="btn-primary !min-h-[40px] !px-5 !text-[15px]" disabled={state === "saved" || busy} onClick={onSave}>
        {saveLabel}
      </button>
    </div>
  );
}

/** "Discard 3 changes?" with what they are, before anything is thrown away. */
export function DiscardSheet({ open, count, labels, onConfirm, onClose }: { open: boolean; count: number; labels: string[]; onConfirm: () => void; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} hideHeader size="sm">
      <div className="pb-2 pt-5 text-center">
        <p className="text-[20px] font-semibold">
          Discard {count} {count === 1 ? "Change" : "Changes"}?
        </p>
        <p className="mx-auto mt-1.5 max-w-xs text-[15px] text-label-2">This puts the page back to how it was when you last saved.</p>
        {labels.length ? <p className="mx-auto mt-2 max-w-xs text-[13px] text-label-3">{labels.join(" · ")}</p> : null}
        <div className="mt-5 space-y-2">
          <button type="button" className="btn w-full bg-danger-soft text-danger" onClick={onConfirm}>
            Discard Changes
          </button>
          <button type="button" className="btn-plain w-full" onClick={onClose}>
            Keep Editing
          </button>
        </div>
      </div>
    </Sheet>
  );
}
