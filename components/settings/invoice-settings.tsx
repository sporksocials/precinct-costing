"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { loadChargeRules, loadInvoiceSuppliers, saveNumericSetting } from "@/lib/invoice-data-extra";
import { AUTO_APPLY_HELP, autoApplyDisplay, invoiceSettingsFromRows, LEARNING_HELP, parseAutoApplyInput, parseDaysInput } from "@/lib/invoice-settings-view";
import { INVOICE_SETTING_KEYS, type InvoiceChargeRuleRow, type InvoiceSettings, type InvoiceSupplierRow } from "@/lib/invoice-types";
import { Banner, Group } from "@/components/ui";
import { SaveNote, SwitchRow, TextField, TouchAddButton } from "@/components/ordering/touch";
import { AiCostBlock } from "@/components/invoices/ai-cost";
import { useSaveLine } from "./invoice-save";
import { InvoiceSuppliers } from "./invoice-suppliers";
import { ChargeRules } from "./invoice-rules";

/**
 * Settings > Invoices: the three numbers that decide when a price may change itself, the learning switch, the invoice suppliers,
 * the charge rules and (for cost viewers only) what reading invoices costs. Each field saves when it is left; there is no Save bar,
 * only one quiet "Saved" line. If the database does not have the Invoices tables yet, the lists say so and the rest still works.
 */
export function InvoiceSettings() {
  const store = useStore();
  const sb = useMemo(() => getSupabaseBrowser(), []);
  const { state, message, track } = useSaveLine();
  const [override, setOverride] = useState<Partial<InvoiceSettings>>({});
  const settings = useMemo<InvoiceSettings>(() => ({ ...invoiceSettingsFromRows(store.rawSettings), ...override }), [store.rawSettings, override]);
  const [suppliers, setSuppliers] = useState<InvoiceSupplierRow[]>([]);
  const [rules, setRules] = useState<InvoiceChargeRuleRow[]>([]);
  const [available, setAvailable] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // bump to put a field back to the saved text after it was clamped or refused
  const [nonce, setNonce] = useState(0);
  const [pctError, setPctError] = useState<string | null>(null);
  const [daysError, setDaysError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([loadInvoiceSuppliers(sb), loadChargeRules(sb)])
      .then(([s, r]) => {
        if (!live) return;
        setSuppliers(s.rows);
        setRules(r.rows);
        setAvailable(s.available && r.available);
        setLoaded(true);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setLoadError(e instanceof Error ? e.message : String(e));
        setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [sb]);

  async function saveNumber(key: string, value: number, patch: Partial<InvoiceSettings>) {
    const ok = await track(saveNumericSetting(sb, key, value).then(() => true));
    if (ok) setOverride((o) => ({ ...o, ...patch }));
    setNonce((n) => n + 1);
  }

  return (
    <>
      <section className="mt-6">
        <h2 className="section-label">Invoices</h2>
        <div className="group-list">
          <TextField
            key={`pct:${nonce}:${settings.autoApplyPct}`}
            label="Auto-Apply Limit"
            suffix="%"
            inputMode="decimal"
            value={autoApplyDisplay(settings.autoApplyPct)}
            error={pctError}
            hint={AUTO_APPLY_HELP}
            onCommit={(t) => {
              const p = parseAutoApplyInput(t);
              if (!p) {
                setPctError("Type a percentage from 0 to 50, such as 5.");
                return;
              }
              setPctError(p.clamped ? "The most it can be is 50%, so it was set to 50%." : null);
              void saveNumber(INVOICE_SETTING_KEYS.autoApplyPct, p.value, { autoApplyPct: p.value });
            }}
          />
          <SwitchRow
            checked={settings.learningMode}
            onChange={(v) => void saveNumber(INVOICE_SETTING_KEYS.learningMode, v ? 1 : 0, { learningMode: v })}
            label="Learning Mode"
            sub={LEARNING_HELP}
          />
          <TextField
            key={`days:${nonce}:${settings.averageDays}`}
            label="Average Cost Window"
            suffix="days"
            inputMode="numeric"
            value={String(settings.averageDays)}
            error={daysError}
            hint="The average cost on an ingredient looks back this many days."
            onCommit={(t) => {
              const p = parseDaysInput(t);
              if (!p) {
                setDaysError("Type a number of days from 7 to 365, such as 90.");
                return;
              }
              setDaysError(p.clamped ? "It can be 7 to 365 days, so it was changed to fit." : null);
              void saveNumber(INVOICE_SETTING_KEYS.averageDays, p.value, { averageDays: p.value });
            }}
          />
        </div>
        <SaveNote state={state} message={message} />
      </section>

      {loadError ? <Banner>{loadError}</Banner> : null}

      <Group title="Invoice Suppliers" footer={available ? "Tap a supplier to change it. Suppliers are added when an invoice from a new one is read." : undefined}>
        {!loaded ? (
          <p className="px-4 py-3 text-[15px] text-label-2">Loading...</p>
        ) : !available ? (
          <p className="px-4 py-3 text-[15px] text-label-2">Invoices are not set up in the database yet. Ask SPORK to apply the Invoices update.</p>
        ) : (
          <InvoiceSuppliers sb={sb} rows={suppliers} learningMode={settings.learningMode} onChange={setSuppliers} track={track} />
        )}
      </Group>

      <Group
        title="Invoice Charge Rules"
        footer={available ? "Delivery and fees are spread over the products on an invoice as part of their cost. Deposits are left out. Turn a rule off with Active; rules are never deleted." : undefined}
        trailing={loaded && available ? <TouchAddButton label="Add Rule" onClick={() => setAdding(true)} /> : undefined}
      >
        {!loaded ? (
          <p className="px-4 py-3 text-[15px] text-label-2">Loading...</p>
        ) : !available ? (
          <p className="px-4 py-3 text-[15px] text-label-2">Invoices are not set up in the database yet.</p>
        ) : (
          <ChargeRules sb={sb} rules={rules} suppliers={suppliers} adding={adding} onAddingChange={setAdding} onChange={setRules} track={track} />
        )}
      </Group>

      <AiCostBlock sb={sb} rate={settings.usdToAud} onSaveRate={(v) => void saveNumber(INVOICE_SETTING_KEYS.usdToAud, v, { usdToAud: v })} />
    </>
  );
}
