"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useStore } from "@/lib/store";
import type { Supplier } from "@/lib/types";
import { cx, useToast } from "./ui";

/**
 * "Add New Supplier" for the supplier pick-list on an ingredient (Troy, 11 Oct 2026: when a supplier was not in the list he had
 * to leave the form, add it somewhere else and come back). A visible text button under the list opens one name field with Add and
 * Cancel. Add saves the supplier to the costing supplier list, selects it through `onAdded`, and closes. A name the list already
 * has (ignoring capitals, spaces and "Pty Ltd") is selected instead of added twice, and the toast says so. It lives inside forms,
 * so Enter adds the supplier and never submits the ingredient form behind it. Every control is 44px at every width (the shared
 * .btn shrinks at sm:, so these carry their own height).
 */
export function AddSupplier({
  onAdded,
  className,
  startOpen = false,
  onCancel,
  selecting = true,
}: {
  onAdded: (supplier: Supplier) => void;
  className?: string;
  /** open the name field straight away (the Suppliers tab, where the header button already said Add Supplier) */
  startOpen?: boolean;
  /** called when the field is closed without adding */
  onCancel?: () => void;
  /** false where nothing is being picked (the Suppliers tab): the toast does not say "selected" */
  selecting?: boolean;
}) {
  const store = useStore();
  const toast = useToast();
  const [open, setOpen] = useState(startOpen);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  function close() {
    onCancel?.();
    setOpen(false);
    setName("");
    setError(null);
    setBusy(false);
  }

  async function add() {
    if (busy) return;
    if (!name.trim()) {
      setError("Type the supplier name first.");
      input.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { supplier, created } = await store.insertSupplier(name);
      onAdded(supplier);
      toast.show({
        message: selecting
          ? created
            ? `Added ${supplier.name} and selected it`
            : `${supplier.name} was already in the list, so it is selected`
          : created
            ? `Added ${supplier.name}`
            : `${supplier.name} was already in the list`,
      });
      setOpen(false);
      setName("");
      setError(null);
      setBusy(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className={cx("inline-flex min-h-[44px] items-center gap-1.5 px-1 text-[17px] font-medium text-accent active:opacity-60 sm:text-[15px]", className)} onClick={() => setOpen(true)}>
        <Plus aria-hidden className="h-4 w-4" strokeWidth={2.5} />
        Add New Supplier
      </button>
    );
  }

  return (
    <div className={cx("space-y-2", className)} role="group" aria-label="Add New Supplier">
      <input
        ref={input}
        autoFocus
        className="field"
        placeholder="Supplier name"
        aria-label="New supplier name"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void add();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
      />
      {error ? <p className="px-1 text-[13px] font-medium text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <button type="button" className="btn-primary !min-h-[44px] flex-1" disabled={busy || !name.trim()} onClick={() => void add()}>
          {busy ? "Adding…" : "Add Supplier"}
        </button>
        <button type="button" className="btn-plain !min-h-[44px]" disabled={busy} onClick={close}>
          Cancel
        </button>
      </div>
    </div>
  );
}
