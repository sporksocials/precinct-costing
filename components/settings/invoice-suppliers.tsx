"use client";

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ChevronRight } from "lucide-react";
import { updateInvoiceSupplier, type SupplierPatch } from "@/lib/invoice-data-extra";
import { abnProblem, ALLOCATION_HELP, aliasesText, autoApplyBlockedReason, cleanAbn, parseAliases } from "@/lib/invoice-settings-view";
import type { InvoiceSupplierRow } from "@/lib/invoice-types";
import { cx } from "@/components/ui";
import { ActiveSwitch, ChoiceBlock, SwitchRow, Tag, TextField, TouchSegmented } from "@/components/ordering/touch";

/** "61 151 388 094" from digits; anything that is not 11 digits is shown as it is. */
function abnShown(abn: string | null): string {
  const d = cleanAbn(abn ?? "");
  return d.length === 11 ? `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : d;
}

function summary(s: InvoiceSupplierRow, learning: boolean): string {
  const parts = [s.abn ? `ABN ${abnShown(s.abn)}` : "No ABN yet", s.allocation_basis === "quantity" ? "Shared by quantity" : "Shared by value"];
  parts.push(s.auto_apply ? (learning ? "Auto-Apply on, waiting for learning mode to end" : "Auto-Apply on") : "Auto-Apply off");
  return parts.join(" · ");
}

/**
 * The invoice suppliers: who an invoice is from and the rules for them. Each is a row that opens to its fields; a field saves
 * when it is left. Suppliers are made by the invoice reader (when it meets a new one), never deleted: Active turns one off.
 */
export function InvoiceSuppliers({
  sb,
  rows,
  learningMode,
  onChange,
  track,
}: {
  sb: SupabaseClient;
  rows: InvoiceSupplierRow[];
  learningMode: boolean;
  onChange: (next: InvoiceSupplierRow[]) => void;
  track: <T>(p: Promise<T>) => Promise<T | undefined>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [nonce, setNonce] = useState(0);

  async function save(id: string, patch: SupplierPatch, errKey?: string) {
    const row = await track(updateInvoiceSupplier(sb, id, patch));
    if (row) {
      onChange(rows.map((r) => (r.id === id ? { ...r, ...row, aliases: Array.isArray(row.aliases) ? row.aliases : [] } : r)));
      if (errKey) setErrors((e) => ({ ...e, [errKey]: null }));
    } else {
      setNonce((n) => n + 1); // put the saved text back in the field
    }
  }

  if (rows.length === 0) return <p className="px-4 py-3 text-[15px] text-label-2">No suppliers yet. They appear here after the first invoice from them is read.</p>;

  const reason = autoApplyBlockedReason(learningMode);
  return (
    <>
      {rows.map((s) => {
        const open = openId === s.id;
        return (
          <div key={s.id}>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : s.id)}
              className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left active:bg-fill"
            >
              <span className="min-w-0 flex-1">
                <span className={cx("block truncate text-[17px]", !s.active && "text-label-2")}>{s.name}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-label-2">{summary(s, learningMode)}</span>
              </span>
              {!s.active ? <Tag>Inactive</Tag> : null}
              <ChevronRight className={cx("h-[18px] w-[18px] shrink-0 text-label-3 transition-transform duration-200", open && "rotate-90")} strokeWidth={2.5} aria-hidden />
            </button>
            {open ? (
              <div className="bg-surface-2 pb-2" key={`${s.id}:${nonce}`}>
                <TextField label="Name" value={s.name} onCommit={(t) => (t.trim() ? void save(s.id, { name: t.replace(/\s+/g, " ").trim() }) : setNonce((n) => n + 1))} />
                <TextField
                  label="ABN"
                  value={abnShown(s.abn)}
                  inputMode="numeric"
                  error={errors[`${s.id}:abn`]}
                  hint="Eleven digits. Used to recognise the supplier on an invoice."
                  onCommit={(t) => {
                    const problem = abnProblem(t);
                    setErrors((e) => ({ ...e, [`${s.id}:abn`]: problem }));
                    if (problem) return;
                    const digits = cleanAbn(t);
                    void save(s.id, { abn: digits || null }, `${s.id}:abn`);
                  }}
                />
                <TextField
                  label="Also Seen As"
                  multiline
                  value={aliasesText(s.aliases)}
                  hint="Other names this supplier uses on invoices. One per line."
                  onCommit={(t) => void save(s.id, { aliases: parseAliases(t) })}
                />
                <ChoiceBlock label="Share Delivery And Fees By" hint={ALLOCATION_HELP}>
                  <TouchSegmented<"value" | "quantity">
                    ariaLabel="Share delivery and fees by"
                    value={s.allocation_basis}
                    onChange={(v) => void save(s.id, { allocation_basis: v })}
                    options={[
                      { value: "value", label: "Value" },
                      { value: "quantity", label: "Quantity" },
                    ]}
                  />
                </ChoiceBlock>
                <SwitchRow
                  checked={s.auto_apply}
                  disabled={learningMode}
                  onChange={(v) => void save(s.id, { auto_apply: v })}
                  label="Auto-Apply"
                  sub={reason ?? "Prices from this supplier can apply themselves when everything checks out."}
                />
                <TextField label="Notes" multiline value={s.notes ?? ""} onCommit={(t) => void save(s.id, { notes: t.trim() || null })} />
                <ActiveSwitch checked={s.active} onChange={(v) => void save(s.id, { active: v })} sub="Off means invoices from this supplier are no longer matched to it." />
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
