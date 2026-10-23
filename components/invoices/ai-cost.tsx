"use client";

import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAiUsage } from "@/lib/invoice-data-extra";
import { aiCostSummary, formatAud, formatUsd, parseRateInput, type AiUsageLite } from "@/lib/invoice-settings-view";
import { Group } from "@/components/ui";
import { TextField } from "@/components/ordering/touch";

const SIX_MONTHS_MS = 190 * 86_400_000; // a little over six months back, so the oldest of the six months is whole

/**
 * "Invoice Reading Cost": what reading invoices has cost on the Anthropic account. Shown ONLY to the people on the cost viewers
 * list (the database hands everyone else an empty log); for anyone else, and while the answer is loading or if it fails, this
 * draws nothing at all, not even a heading.
 */
export function AiCostBlock({ sb, rate, onSaveRate }: { sb: SupabaseClient; rate: number; onSaveRate: (rate: number) => void }) {
  const [rows, setRows] = useState<AiUsageLite[] | null>(null);
  const [visible, setVisible] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const now = useMemo(() => new Date().toISOString(), []);

  useEffect(() => {
    let live = true;
    void loadAiUsage(sb, new Date(Date.now() - SIX_MONTHS_MS).toISOString()).then((r) => {
      if (!live) return;
      setVisible(r.visible);
      setRows(r.rows);
    });
    return () => {
      live = false;
    };
  }, [sb]);

  const summary = useMemo(() => aiCostSummary(rows ?? [], now, rate), [rows, now, rate]);
  if (!visible || rows === null) return null;
  const m = summary.month;

  return (
    <Group title="Invoice Reading Cost" footer="Billed to the Anthropic account in US dollars. Only the people listed as cost viewers see this.">
      <div className="px-4 py-3">
        <p className="text-[13px] font-medium text-label-2">This Month ({m.label})</p>
        <p className="mt-0.5 text-[28px] font-semibold leading-tight tnum">{formatUsd(m.usd)}</p>
        <p className="text-[15px] text-label-2 tnum">About {formatAud(m.aud)} (approximate)</p>
      </div>
      <div className="grid grid-cols-2 gap-3 px-4 py-3">
        <div>
          <p className="text-[13px] font-medium text-label-2">Invoices Read</p>
          <p className="mt-0.5 text-[20px] font-semibold tnum">{m.invoices}</p>
        </div>
        <div>
          <p className="text-[13px] font-medium text-label-2">Average Per Invoice</p>
          <p className="mt-0.5 text-[20px] font-semibold tnum">{m.avgUsd != null ? formatUsd(m.avgUsd) : "None yet"}</p>
          {m.avgAud != null ? <p className="text-[13px] text-label-2 tnum">About {formatAud(m.avgAud)}</p> : null}
        </div>
      </div>
      <div className="px-4 py-3">
        <p className="mb-1.5 text-[13px] font-medium text-label-2">Last Six Months</p>
        <table className="w-full text-[15px] tnum">
          <thead>
            <tr className="text-left text-[13px] text-label-2">
              <th scope="col" className="py-1 pr-2 font-medium">
                Month
              </th>
              <th scope="col" className="py-1 pr-2 text-right font-medium">
                Calls
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Cost
              </th>
            </tr>
          </thead>
          <tbody>
            {summary.months.map((x) => (
              <tr key={x.key} className="border-t border-[color:var(--separator)]">
                <td className="py-2 pr-2">{x.label}</td>
                <td className="py-2 pr-2 text-right">{x.calls}</td>
                <td className="py-2 text-right">{formatUsd(x.usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TextField
        key={`${rate}:${nonce}`}
        label="US To Australian Dollar Rate"
        value={String(rate)}
        inputMode="decimal"
        error={rateError}
        hint="An estimate, used only to show the approximate Australian figure above."
        onCommit={(t) => {
          const v = parseRateInput(t);
          if (v == null) {
            setRateError("Type a rate between 0.5 and 5, such as 1.55.");
            return;
          }
          setRateError(null);
          onSaveRate(v);
          setNonce((n) => n + 1);
        }}
      />
    </Group>
  );
}
