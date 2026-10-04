"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { ACTIVE_LABEL, ACTIVE_SUB, INACTIVE_TAG, showInactiveLabel } from "@/lib/active";
import {
  deleteDecision,
  inactiveImpactLines,
  needsOffConfirm,
  nameList,
  recordNoun,
  usageOfBeer,
  usageOfIngredient,
  usageOfItem,
  usageOfPrep,
  type RecordImpact,
  type RecordKind,
  type UsageData,
} from "@/lib/record-usage";
import { Banner, Sheet, Toggle, useToast } from "./ui";

/**
 * The shared pieces of "Active, not Delete" (rules in lib/active.ts): the small Inactive tag, the Show Inactive button,
 * the one Active switch, and the impact sheet every Delete goes through.
 */

/** The small "Inactive" tag after a row title. */
export function InactiveTag() {
  return <span className="ml-2 inline-flex h-[18px] items-center rounded-[5px] bg-fill px-1.5 align-[1px] text-[11px] font-semibold leading-none text-label-2">{INACTIVE_TAG}</span>;
}

/** A row or table title with the Inactive tag when the record is off. */
export function TitleWithTag({ name, active }: { name: React.ReactNode; active: boolean }) {
  return (
    <>
      <span className={active ? undefined : "text-label-2"}>{name}</span>
      {active ? null : <InactiveTag />}
    </>
  );
}

/** "Show Inactive (3)" / "Hide Inactive": a visible text button, shown only when the list has inactive records. */
export function ShowInactiveButton({ count, show, onToggle, className }: { count: number; show: boolean; onToggle: () => void; className?: string }) {
  if (!count) return null;
  return (
    <button type="button" className={className ?? "text-[13px] font-medium text-accent"} onClick={onToggle}>
      {showInactiveLabel(show, count)}
    </button>
  );
}

/** Everything the usage helpers need, from the store. */
export function useUsageData(): UsageData {
  const store = useStore();
  return useMemo(
    () => ({
      lines: store.lines,
      items: store.storedItems,
      preps: store.preps,
      serveLines: store.gelatoServeLines,
      serves: store.gelatoServes,
      beers: store.beers,
      offerLines: store.offerLines,
      offers: store.offers,
    }),
    [store.lines, store.storedItems, store.preps, store.gelatoServeLines, store.gelatoServes, store.beers, store.offerLines, store.offers],
  );
}

/** What uses a menu item, prep, ingredient or tap beer (other kinds have no references). */
export function useRecordImpact(kind: RecordKind, id: string | null | undefined, notes: string[] = []): RecordImpact {
  const data = useUsageData();
  const noteKey = notes.join("|");
  return useMemo(() => {
    if (!id) return { refs: [], notes };
    const refs = kind === "ingredient" ? usageOfIngredient(id, data) : kind === "prep" ? usageOfPrep(id, data) : kind === "item" ? usageOfItem(id, data) : kind === "beer" ? usageOfBeer(id, data) : [];
    return { refs, notes };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id, data, noteKey]);
}

/** Names of what uses a record, as short rows (up to five, then "and N more"). */
function UsageNames({ impact }: { impact: RecordImpact }) {
  const list = nameList(impact.refs, 5);
  if (!list.names.length) return null;
  return (
    <ul className="mx-auto mt-3 max-w-xs space-y-0.5 text-center text-[15px] text-label sm:text-[13px]" aria-label="Used by">
      {list.names.map((n, i) => (
        <li key={`${n}-${i}`} className="truncate">
          {n}
        </li>
      ))}
      {list.more ? <li className="text-label-2">and {list.more} more</li> : null}
    </ul>
  );
}

/**
 * THE Active switch. Same label and sub line on every record page (lib/active.ts). Turning it OFF on a record that other
 * records use opens a small confirmation with the impact first; turning it ON never asks. When the record is off but still
 * used, a line under the switch says the recipes keep their cost.
 *
 * `onChange` does the write (an instant save, or a draft change on a page with a Save bar). With `undo` an Undo toast follows.
 */
export function ActiveToggle({
  checked,
  onChange,
  record,
  name,
  impact,
  label = ACTIVE_LABEL,
  sub = ACTIVE_SUB,
  undo = false,
  onError,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => Promise<unknown> | void;
  record: RecordKind;
  name: string;
  impact: RecordImpact;
  label?: string;
  sub?: string;
  /** show an Undo toast after the change (pages that save instantly) */
  undo?: boolean;
  onError?: (message: string) => void;
  /** extra impact shown in the confirmation (e.g. the dishes a live deal moves) */
  children?: React.ReactNode;
}) {
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmLines = inactiveImpactLines(record, impact);
  const confirmNeeded = needsOffConfirm(impact);

  async function commit(v: boolean): Promise<boolean> {
    try {
      await onChange(v);
      if (undo) {
        toast.show({
          message: v ? `${name} is active again` : `${name} is now inactive`,
          action: {
            label: "Undo",
            onClick: () => {
              void Promise.resolve(onChange(!v)).catch((e) => onError?.(e instanceof Error ? e.message : String(e)));
            },
          },
        });
      }
      return true;
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (onError) onError(m);
      else toast.show({ message: m });
      return false;
    }
  }

  function request(v: boolean) {
    if (!v && confirmNeeded) {
      setError(null);
      setConfirm(true);
      return;
    }
    void commit(v);
  }

  const note = !checked && impact.refs.length > 0 ? inactiveImpactLines(record, { refs: impact.refs, notes: [] })[0] : null;
  return (
    <>
      <Toggle
        label={label}
        sub={
          note ? (
            <>
              {sub}
              <span className="mt-1 block text-label">{note}</span>
            </>
          ) : (
            sub
          )
        }
        checked={checked}
        onChange={request}
      />
      <Sheet open={confirm} onClose={() => (busy ? undefined : setConfirm(false))} hideHeader size="sm">
        <div className="pb-2 pt-5 text-center">
          <p className="text-[20px] font-semibold">Make “{name}” Inactive?</p>
          {confirmLines.map((l, i) => (
            <p key={i} className="mx-auto mt-1.5 max-w-xs text-[15px] text-label-2">
              {l}
            </p>
          ))}
          <UsageNames impact={impact} />
          {children}
          {error ? <Banner>{error}</Banner> : null}
          <div className="mt-5 space-y-2">
            <button
              type="button"
              className="btn-primary w-full"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const ok = await commit(false);
                setBusy(false);
                if (ok) setConfirm(false);
                else setError("That change did not save. Nothing was changed.");
              }}
            >
              {busy ? "Saving…" : "Make Inactive"}
            </button>
            <button type="button" className="btn-plain w-full" disabled={busy} onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </div>
        </div>
      </Sheet>
    </>
  );
}

/**
 * The sheet every Delete opens. Impact first (what the record is, what uses it), then "Make Inactive Instead" as the visible
 * primary button, then, only when nothing uses the record, a plain "Delete Permanently" with "This cannot be undone."
 * `onMakeInactive` and `onDelete` do the work; the caller handles navigation and toasts.
 */
export function DeleteRecordSheet({
  record,
  name,
  impact,
  alreadyInactive = false,
  onMakeInactive,
  onDelete,
  onClose,
  children,
}: {
  record: RecordKind;
  name: string;
  impact: RecordImpact;
  alreadyInactive?: boolean;
  onMakeInactive: () => Promise<unknown> | void;
  onDelete: () => Promise<unknown> | void;
  onClose: () => void;
  /** extra impact (e.g. the dishes a deal moves) */
  children?: React.ReactNode;
}) {
  const [busy, setBusy] = useState<null | "archive" | "delete">(null);
  const [error, setError] = useState<string | null>(null);
  const d = deleteDecision({ record, name, impact, alreadyInactive });

  async function run(kind: "archive" | "delete", fn: () => Promise<unknown> | void, closeAfter: boolean) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      if (closeAfter) onClose();
      else setBusy(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  return (
    <Sheet open onClose={() => (busy ? undefined : onClose())} hideHeader size="sm">
      <div className="pb-2 pt-5 text-center" data-testid="delete-sheet">
        <p className="text-[20px] font-semibold">{d.title}</p>
        <p className="mx-auto mt-1 max-w-xs text-[13px] text-label-2">
          {recordNoun(record).replace(/^./, (c) => c.toUpperCase())}
          {alreadyInactive ? " · Inactive" : ""}
        </p>
        <p className="mx-auto mt-3 max-w-xs text-[15px] text-label-2">{d.blockedReason ?? d.lead}</p>
        <UsageNames impact={impact} />
        {d.notes.map((n, i) => (
          <p key={i} className="mx-auto mt-2 max-w-xs text-[13px] text-label-2">
            {n}
          </p>
        ))}
        {children}
        {error ? <Banner>{error}</Banner> : null}
        <div className="mt-5 space-y-2">
          <button type="button" className="btn-primary w-full" disabled={busy != null} onClick={() => (d.archiveChangesRecord ? void run("archive", onMakeInactive, true) : onClose())}>
            {busy === "archive" ? "Saving…" : d.archiveLabel}
          </button>
          {d.canDelete ? (
            <div className="pt-2">
              <p className="mb-1.5 text-[13px] text-label-2">{d.deleteWarning}</p>
              <button type="button" className="btn w-full bg-danger-soft text-danger" disabled={busy != null} onClick={() => void run("delete", onDelete, false)}>
                {busy === "delete" ? "Deleting…" : d.deleteLabel}
              </button>
            </div>
          ) : null}
          <button type="button" className="btn-plain w-full" disabled={busy != null} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Sheet>
  );
}
