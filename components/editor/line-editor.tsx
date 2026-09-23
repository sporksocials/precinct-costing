"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { money, unitShort } from "@/lib/format";
import { parseNumberToken } from "@/lib/parse-qty";
import { search } from "@/lib/search";
import { LINE_UNITS, type LineUnit, type RecipeLine } from "@/lib/types";
import type { LineCost } from "@/lib/costing";
import { cx, SearchField, Segmented } from "../ui";
import { PrepBadge, useComponentDocs } from "./smart-add";

export interface LinePatch {
  qty?: number;
  unit?: LineUnit;
  note?: string | null;
  component_type?: RecipeLine["component_type"];
  component_id?: string;
}

/** Edit one recipe line: qty, unit, swap component, note, reorder, delete. */
export function LineEditor({
  line,
  cost,
  warning,
  onChange,
  onDelete,
  onMove,
  canUp,
  canDown,
  excludePrepId,
  focusQty,
  showMove,
  onDone,
}: {
  onDone?: () => void;
  line: RecipeLine;
  cost: LineCost | undefined;
  warning: string | null;
  onChange: (p: LinePatch) => void;
  onDelete: () => void;
  onMove?: (dir: -1 | 1) => void;
  canUp?: boolean;
  canDown?: boolean;
  excludePrepId?: string;
  focusQty?: boolean;
  showMove?: boolean;
}) {
  const [qtyText, setQtyText] = useState(line.qty ? String(line.qty) : "");
  const [swapping, setSwapping] = useState(false);

  const commitQty = (t: string) => {
    const n = parseNumberToken(t);
    if (n != null && n !== line.qty) onChange({ qty: n });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          autoFocus={focusQty}
          inputMode="decimal"
          value={qtyText}
          placeholder="Qty"
          aria-label="Quantity"
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            setQtyText(e.target.value);
            const n = parseNumberToken(e.target.value);
            if (n != null) onChange({ qty: n });
          }}
          onBlur={(e) => commitQty(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="field w-28 text-right !text-[20px] font-semibold tnum"
        />
        <Segmented ariaLabel="Unit" className="flex-1" value={line.unit} onChange={(u) => onChange({ unit: u })} options={LINE_UNITS.map((u) => ({ value: u, label: u === "each" ? "each" : u }))} />
      </div>

      {warning ? <p className="rounded-xl bg-fill px-3 py-2 text-[13px] text-warn">⚠ {warning}</p> : null}

      <div className="group-list !bg-fill [--inset:0.875rem]">
        <div className="flex min-h-[44px] items-center gap-3 px-3.5">
          <span className="min-w-0 flex-1 truncate text-[17px] sm:text-[15px]">
            {cost?.componentName ?? "—"}
            {line.component_type === "prep" ? <PrepBadge /> : null}
          </span>
          <button type="button" className="btn-text shrink-0 !min-h-[36px]" onClick={() => setSwapping((s) => !s)}>
            {swapping ? "Cancel" : "Swap"}
          </button>
        </div>
        {cost && cost.unitCost ? (
          <p className="px-3.5 py-2 text-[13px] text-label-2 tnum">
            {money(cost.unitCost)}/{unitShort(cost.componentBase ?? "")} · line {money(cost.cost)}
          </p>
        ) : null}
      </div>
      {swapping ? (
        <SwapPicker
          excludePrepId={excludePrepId}
          onPick={(ctype, id) => {
            onChange({ component_type: ctype, component_id: id });
            setSwapping(false);
          }}
        />
      ) : null}

      <input className="field" placeholder="Note (optional)" value={line.note ?? ""} onChange={(e) => onChange({ note: e.target.value || null })} aria-label="Note" />

      <div className="flex items-center gap-2">
        {showMove && onMove ? (
          <>
            <button type="button" className="btn-plain flex-1" disabled={!canUp} onClick={() => onMove(-1)}>
              <ArrowUp className="h-4 w-4" /> Up
            </button>
            <button type="button" className="btn-plain flex-1" disabled={!canDown} onClick={() => onMove(1)}>
              <ArrowDown className="h-4 w-4" /> Down
            </button>
          </>
        ) : null}
        <button type="button" className={cx("btn bg-danger-soft text-danger", showMove ? "flex-1" : "")} onClick={onDelete}>
          <Trash2 className="h-4 w-4" /> Remove
        </button>
        {onDone ? (
          <button type="button" className="btn-tinted ml-auto" onClick={onDone}>
            Done
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SwapPicker({ onPick, excludePrepId }: { onPick: (t: RecipeLine["component_type"], id: string) => void; excludePrepId?: string }) {
  const docs = useComponentDocs(excludePrepId);
  const [q, setQ] = useState("");
  const hits = useMemo(() => (q.trim() ? search(docs, q, 8).map((h) => h.doc) : []), [docs, q]);
  return (
    <div>
      <SearchField autoFocus value={q} onChange={setQ} placeholder="Swap for…" />
      {hits.length ? (
        <div className="group-list mt-2 !bg-fill [--inset:0.875rem]">
          {hits.map((d) => (
            <button key={d.id} type="button" onClick={() => onPick(d.ctype, d.id)} className="flex min-h-[44px] w-full flex-col justify-center px-3.5 py-1.5 text-left active:bg-fill-2">
              <span className="truncate text-[15px]">
                {d.title}
                {d.ctype === "prep" ? <PrepBadge /> : null}
              </span>
              <span className="truncate text-[13px] text-label-2">{d.sub}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
