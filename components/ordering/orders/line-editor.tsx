"use client";

import { AlertTriangle } from "lucide-react";
import { qtyText } from "@/lib/ordering";
import { notPackMultiple, priceCells, type DraftLine } from "@/lib/ordering-orders-ui";
import { QtyControl, RemoveButton } from "./parts";

/**
 * The lines of one order, editable: a table when the card is wide, stacked rows when it is narrow. Same controls either
 * way (44 px buttons, a typed field). A quantity of 0 keeps the line on screen as "Not ordered"; Remove takes it off.
 */
export function LineEditor({ lines, showPrices, wide, onQty, onRemove }: { lines: DraftLine[]; showPrices: boolean; wide: boolean; onQty: (key: string, qty: number) => void; onRemove: (key: string) => void }) {
  if (!lines.length) return <p className="px-4 py-4 text-[15px] text-label-2">Nothing on this order yet. Use Add Product to put something on it.</p>;
  return wide ? <LineTable lines={lines} showPrices={showPrices} onQty={onQty} onRemove={onRemove} /> : <LineList lines={lines} showPrices={showPrices} onQty={onQty} onRemove={onRemove} />;
}

type Handlers = { lines: DraftLine[]; showPrices: boolean; onQty: (key: string, qty: number) => void; onRemove: (key: string) => void };

const dash = "-";

function ProductCell({ line }: { line: DraftLine }) {
  return (
    <>
      <span className="block text-[16px] font-medium leading-snug text-label">{line.name}</span>
      <span className="mt-0.5 block text-[13px] text-label-2">
        {line.unit ? `Per ${line.unit}` : "Typed line"}
        {line.code ? ` · Item ${line.code}` : ""}
        {line.suggested == null ? " · Added by hand" : ""}
      </span>
    </>
  );
}

function PackNote({ line }: { line: DraftLine }) {
  if (!notPackMultiple(line)) return null;
  return (
    <span className="mt-1 flex items-center gap-1 text-[13px] text-warn">
      <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
      <span className="text-label-2">Sold in packs of {qtyText(line.packMultiple ?? 1)}</span>
    </span>
  );
}

function Money({ ex, inc, label }: { ex: string | null; inc: string | null; label?: string }) {
  if (ex == null || inc == null) return <span className="text-[13px] text-label-2">No price</span>;
  return (
    <span className="block text-[14px] leading-snug tnum">
      <span className="block">
        {ex} <span className="text-[12px] text-label-2">ex GST{label ? ` ${label}` : ""}</span>
      </span>
      <span className="block text-label-2">
        {inc} <span className="text-[12px]">inc GST{label ? ` ${label}` : ""}</span>
      </span>
    </span>
  );
}

function LineTable({ lines, showPrices, onQty, onRemove }: Handlers) {
  return (
    <table className="w-full table-fixed text-left">
      <thead>
        <tr className="text-[12px] font-medium uppercase tracking-wide text-label-2">
          <th scope="col" className="px-4 pb-1 pt-3 font-medium">Product</th>
          <th scope="col" className="w-[68px] px-1 pb-1 pt-3 text-right font-medium">Build To</th>
          <th scope="col" className="w-[68px] px-1 pb-1 pt-3 text-right font-medium">Counted</th>
          <th scope="col" className="w-[84px] px-1 pb-1 pt-3 text-right font-medium">Suggested</th>
          <th scope="col" className="w-[204px] px-3 pb-1 pt-3 font-medium">Order</th>
          {showPrices ? (
            <>
              <th scope="col" className="w-[124px] px-1 pb-1 pt-3 font-medium">Price</th>
              <th scope="col" className="w-[124px] px-1 pb-1 pt-3 font-medium">Line Total</th>
            </>
          ) : null}
          <th scope="col" className="w-[60px] px-2 pb-1 pt-3"><span className="sr-only">Remove</span></th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => {
          const p = priceCells(l.qty, l.price);
          return (
            <tr key={l.key} className={`border-t border-[color:var(--separator)] align-middle ${l.qty <= 0 ? "opacity-60" : ""}`}>
              <td className="px-4 py-2.5">
                <ProductCell line={l} />
                {l.qty <= 0 ? <span className="mt-1 block text-[13px] font-medium text-label-2">Not ordered</span> : null}
              </td>
              <td className="px-1 py-2.5 text-right text-[15px] tnum text-label-2">{l.par == null ? dash : qtyText(l.par)}</td>
              <td className="px-1 py-2.5 text-right text-[15px] tnum text-label-2">{l.counted == null ? dash : qtyText(l.counted)}</td>
              <td className="px-1 py-2.5 text-right text-[15px] tnum text-label-2">{l.suggested == null ? dash : qtyText(l.suggested)}</td>
              <td className="px-3 py-2.5">
                <QtyControl line={l} onChange={(n) => onQty(l.key, n)} />
                <PackNote line={l} />
              </td>
              {showPrices ? (
                <>
                  <td className="px-1 py-2.5"><Money ex={p.unitEx} inc={p.unitInc} /></td>
                  <td className="px-1 py-2.5">{l.qty > 0 ? <Money ex={p.totalEx} inc={p.totalInc} /> : <span className="text-[13px] text-label-2">{dash}</span>}</td>
                </>
              ) : null}
              <td className="px-2 py-2.5 text-right"><RemoveButton name={l.name} onClick={() => onRemove(l.key)} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function LineList({ lines, showPrices, onQty, onRemove }: Handlers) {
  return (
    <ul>
      {lines.map((l) => {
        const p = priceCells(l.qty, l.price);
        return (
          <li key={l.key} className={`border-t border-[color:var(--separator)] px-4 py-3 first:border-t-0 ${l.qty <= 0 ? "opacity-60" : ""}`}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <ProductCell line={l} />
              </div>
              <RemoveButton name={l.name} onClick={() => onRemove(l.key)} />
            </div>
            <p className="mt-1 text-[13px] text-label-2 tnum">
              {l.par == null ? "Added by hand" : `Build To ${qtyText(l.par)}`}
              {l.counted != null ? ` · Counted ${qtyText(l.counted)}` : ""}
              {l.suggested != null ? ` · Suggested ${qtyText(l.suggested)}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <QtyControl line={l} onChange={(n) => onQty(l.key, n)} />
              {showPrices ? (
                <div className="min-w-0 text-right">
                  {l.qty > 0 ? <Money ex={p.totalEx} inc={p.totalInc} /> : <span className="text-[13px] text-label-2">Not ordered</span>}
                  {p.unitInc ? <span className="mt-0.5 block text-[12px] text-label-2 tnum">{p.unitInc} inc GST each</span> : null}
                </div>
              ) : l.qty <= 0 ? (
                <span className="text-[13px] font-medium text-label-2">Not ordered</span>
              ) : null}
            </div>
            <PackNote line={l} />
          </li>
        );
      })}
    </ul>
  );
}
