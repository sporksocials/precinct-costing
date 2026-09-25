"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { dateShort, movePct } from "@/lib/format";
import { buildTimeline, type AuditRow, type TimelineEntry } from "@/lib/ingredient-history";
import type { PriceLog } from "@/lib/types";
import { cx, Group, Row } from "./ui";

const SHOWN = 12;

const who = (email: string | null) => (email ? email.split("@")[0] : null);

/** Percent move between two "$x.xx" strings, only for price rows. */
function pct(e: TimelineEntry): number | null {
  if (e.kind !== "price" || !e.from || !e.to) return null;
  const a = Number(e.from.replace("$", ""));
  const b = Number(e.to.replace("$", ""));
  return a > 0 ? b / a - 1 : null;
}

/**
 * One timeline for an ingredient: price changes (cost_price_log), price confirmations and every other tracked field
 * change (cost_audit_log: pack size, unit, yield, rebate, GST, supplier, name, active). The audit rows load on demand
 * when the section opens. If the audit table is missing or empty the price history still shows.
 */
export function IngredientHistory({
  ingredientId,
  version,
  logs,
  supplierName,
  skip,
  chart,
}: {
  ingredientId: string;
  /** changes whenever the ingredient is saved, so new audit rows appear without a reload */
  version: string;
  /** price log rows for this ingredient, null while loading */
  logs: PriceLog[] | null;
  supplierName: (id: number) => string | undefined;
  /** price rows that are not price changes (alternate prices from the source sheets) */
  skip: (l: PriceLog) => boolean;
  chart?: React.ReactNode;
}) {
  const [audits, setAudits] = useState<AuditRow[] | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve(
      getSupabaseBrowser()
        .from("cost_audit_log")
        .select("id, column_name, old_value, new_value, changed_by, changed_at")
        .eq("table_name", "cost_ingredients")
        .eq("row_key", ingredientId)
        .eq("op", "update")
        .order("changed_at", { ascending: false })
        .limit(200),
    )
      .then(({ data, error }) => {
        if (!cancelled) setAudits(error ? [] : ((data ?? []) as AuditRow[]));
      })
      .catch(() => {
        if (!cancelled) setAudits([]);
      });
    return () => {
      cancelled = true;
    };
  }, [ingredientId, version]);

  const timeline = useMemo(() => buildTimeline(logs ?? [], audits ?? [], supplierName, skip), [logs, audits, supplierName, skip]);
  const loading = logs === null || audits === null;
  const shown = all ? timeline : timeline.slice(0, SHOWN);
  const noOther = audits !== null && audits.length === 0;

  return (
    <Group title="History" className="mt-7" footer={!loading && noOther ? "No other changes recorded yet." : undefined}>
      {loading ? (
        <p className="px-4 py-3 text-[15px] text-label-2">Loading…</p>
      ) : timeline.length === 0 ? (
        <p className="px-4 py-3 text-[15px] text-label-2">No price changes logged yet.</p>
      ) : (
        <>
          {chart}
          {shown.map((e) => {
            const m = pct(e);
            const values = e.kind === "confirmed" ? `${e.to} still right` : e.from != null ? `${e.from} → ${e.to}` : (e.to ?? "");
            return (
              <Row
                key={e.key}
                title={<span className="tnum">{values}</span>}
                sub={[e.title, dateShort(e.at), e.note, who(e.by)].filter(Boolean).join(" · ")}
                trailing={m != null ? <span className={cx(m > 0 ? "text-danger" : "text-label-2")}>{movePct(m)}</span> : null}
              />
            );
          })}
          {timeline.length > SHOWN ? (
            <button type="button" className="btn-text w-full justify-center" onClick={() => setAll((v) => !v)}>
              {all ? "Show Fewer" : `Show All ${timeline.length}`}
            </button>
          ) : null}
        </>
      )}
    </Group>
  );
}
