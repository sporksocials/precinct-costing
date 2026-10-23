"use client";

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ChevronRight } from "lucide-react";
import { insertChargeRule, updateChargeRule, type RulePatch } from "@/lib/invoice-data-extra";
import { CHARGE_KINDS, chargeKindLabel, defaultSpread, ruleProblem, RULE_TEXT_MAX, SPREAD_LABEL, spreadSub, tidyRuleText } from "@/lib/invoice-settings-view";
import type { InvoiceChargeRuleRow, InvoiceSupplierRow, LineClass } from "@/lib/invoice-types";
import { cx } from "@/components/ui";
import { ActiveSwitch, ChoiceBlock, SwitchRow, Tag, TextField, TouchChips, TouchSheet } from "@/components/ordering/touch";

type Kind = (typeof CHARGE_KINDS)[number]["value"];
const KIND_OPTIONS = CHARGE_KINDS.map((k) => ({ value: k.value, label: k.label }));
const asKind = (c: LineClass): Kind => (CHARGE_KINDS.some((k) => k.value === c) ? (c as Kind) : "other");

function scopeText(r: InvoiceChargeRuleRow, suppliers: readonly InvoiceSupplierRow[]): string {
  if (!r.supplier_id) return "Every supplier";
  return suppliers.find((s) => s.id === r.supplier_id)?.name ?? "One supplier";
}

/**
 * Charge rules: what a delivery, fee, deposit or discount line is, and whether it is spread over the products as landed cost.
 * They are data, so a change here changes the next invoice read and nothing else. Rules are never deleted: Active turns one off.
 */
export function ChargeRules({
  sb,
  rules,
  suppliers,
  adding,
  onAddingChange,
  onChange,
  track,
}: {
  sb: SupabaseClient;
  rules: InvoiceChargeRuleRow[];
  suppliers: InvoiceSupplierRow[];
  adding: boolean;
  onAddingChange: (v: boolean) => void;
  onChange: (next: InvoiceChargeRuleRow[]) => void;
  track: <T>(p: Promise<T>) => Promise<T | undefined>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  async function save(id: string, patch: RulePatch) {
    const row = await track(updateChargeRule(sb, id, patch));
    if (row) onChange(rules.map((r) => (r.id === id ? row : r)));
    else setNonce((n) => n + 1);
  }

  // active rules first, each group in the order they were made
  const sorted = [...rules].sort((a, b) => Number(b.active) - Number(a.active));
  return (
    <>
      {sorted.length === 0 ? <p className="px-4 py-3 text-[15px] text-label-2">No rules yet. Tap Add Rule to make one.</p> : null}
      {sorted.map((r) => {
        const open = openId === r.id;
        return (
          <div key={r.id}>
            <button type="button" aria-expanded={open} onClick={() => setOpenId(open ? null : r.id)} className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left active:bg-fill">
              <span className="min-w-0 flex-1">
                <span className={cx("block truncate text-[17px]", !r.active && "text-label-2")}>{r.match_text}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-label-2">
                  {chargeKindLabel(r.line_class)} · {r.spread ? "Spread over the products" : "Left out of cost"} · {scopeText(r, suppliers)}
                </span>
              </span>
              {!r.active ? <Tag>Inactive</Tag> : null}
              <ChevronRight className={cx("h-[18px] w-[18px] shrink-0 text-label-3 transition-transform duration-200", open && "rotate-90")} strokeWidth={2.5} aria-hidden />
            </button>
            {open ? (
              <div className="bg-surface-2 pb-2" key={`${r.id}:${nonce}`}>
                <TextField
                  label="Words To Look For"
                  value={r.match_text}
                  error={errors[r.id]}
                  hint="Matches the description or item code on an invoice line, in any capitals."
                  onCommit={(t) => {
                    const problem = ruleProblem(t, r.supplier_id, rules, r.id);
                    setErrors((e) => ({ ...e, [r.id]: problem }));
                    if (!problem) void save(r.id, { match_text: tidyRuleText(t) });
                  }}
                />
                <ChoiceBlock label="What It Is">
                  <TouchChips<Kind> wrap ariaLabel="What it is" options={KIND_OPTIONS} value={asKind(r.line_class)} onChange={(k) => void save(r.id, { line_class: k })} />
                </ChoiceBlock>
                <SwitchRow checked={r.spread} onChange={(v) => void save(r.id, { spread: v })} label={SPREAD_LABEL} sub={spreadSub(r.spread)} />
                <TextField label="Note" multiline value={r.note ?? ""} onCommit={(t) => void save(r.id, { note: t.trim() || null })} />
                <ActiveSwitch checked={r.active} onChange={(v) => void save(r.id, { active: v })} sub="Off means invoice lines are no longer checked against this rule." />
              </div>
            ) : null}
          </div>
        );
      })}
      <AddRuleSheet sb={sb} open={adding} onClose={() => onAddingChange(false)} rules={rules} suppliers={suppliers} onAdded={(row) => onChange([...rules, row])} track={track} />
    </>
  );
}

function AddRuleSheet({
  sb,
  open,
  onClose,
  rules,
  suppliers,
  onAdded,
  track,
}: {
  sb: SupabaseClient;
  open: boolean;
  onClose: () => void;
  rules: readonly InvoiceChargeRuleRow[];
  suppliers: readonly InvoiceSupplierRow[];
  onAdded: (row: InvoiceChargeRuleRow) => void;
  track: <T>(p: Promise<T>) => Promise<T | undefined>;
}) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<Kind>("delivery");
  const [spread, setSpread] = useState(true);
  const [note, setNote] = useState("");
  const [scope, setScope] = useState("all");
  const [shown, setShown] = useState(false); // show the problem only after a first try
  const supplierId = scope === "all" ? null : scope;
  const problem = ruleProblem(text, supplierId, rules);

  function reset() {
    setText("");
    setKind("delivery");
    setSpread(true);
    setNote("");
    setScope("all");
    setShown(false);
  }
  async function add() {
    setShown(true);
    if (problem) return;
    const row = await track(insertChargeRule(sb, { match_text: tidyRuleText(text), line_class: kind, spread, note: note.trim() || null, supplier_id: supplierId }));
    if (row) {
      onAdded(row);
      reset();
      onClose();
    }
  }
  return (
    <TouchSheet open={open} onClose={onClose} title="New Charge Rule" action={{ label: "Add", onClick: () => void add() }}>
      <TextField label="Words To Look For" value={text} onChangeText={setText} onCommit={setText} placeholder="For example fuel levy" hint={`Up to ${RULE_TEXT_MAX} letters. Matches the description or item code on an invoice line.`} error={shown ? problem : null} autoFocus />
      <ChoiceBlock label="What It Is">
        <TouchChips<Kind>
          wrap
          ariaLabel="What it is"
          options={KIND_OPTIONS}
          value={kind}
          onChange={(k) => {
            setKind(k);
            setSpread(defaultSpread(k));
          }}
        />
      </ChoiceBlock>
      <SwitchRow checked={spread} onChange={setSpread} label={SPREAD_LABEL} sub={spreadSub(spread)} />
      <TextField label="Note" multiline value={note} onChangeText={setNote} onCommit={setNote} />
      <ChoiceBlock label="Applies To">
        <TouchChips<string> wrap ariaLabel="Applies to" value={scope} onChange={setScope} options={[{ value: "all", label: "Every Supplier" }, ...suppliers.filter((s) => s.active).map((s) => ({ value: s.id, label: s.name }))]} />
      </ChoiceBlock>
    </TouchSheet>
  );
}
