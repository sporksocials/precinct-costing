"use client";

import { AlertTriangle } from "lucide-react";
import { qtyText } from "@/lib/ordering";
import { countedLine, linePrice, notPackMultiple, type DraftLine } from "@/lib/ordering-orders-ui";
import { QtyControl, RemoveButton } from "./parts";

/**
 * The lines of one order, editable: a table when the card is wide, stacked rows when it is narrow. Same controls either
 * way (44 px buttons, a typed field). Each line is the product, "Per carton, Item 100101", one quiet "Counted 5 of 8" line,
 * the quantity (it starts at the suggestion) and, when the supplier shows prices, ONE price. A quantity of 0 keeps the line
 * on screen as "Not ordered"; Remove takes it off.
 */
export function LineEditor({ lines, showPrices, wide, onQty, onRemove }: { lines: DraftLine[]; showPrices: boolean; wide: boolean; onQty: (key: string, qty: number) => void; onRemove: (key: string) => void }) {
  if (!lines.length) return <p className="px-4 py-4 text-[15px] text-label-2">Nothing on this order yet. Use Add Product to put something on it.</p>;
  return wide ? <LineTable lines={lines} showPrices={showPrices} onQty={onQty} onRemove={onRemove} /> : <LineList lines={lines} showPrices={showPrices} onQty={onQty} onRemove={onRemove} />;
}

type Handlers = { lines: DraftLine[]; showPrices: boolean; onQty: (key: string, qty: number) => void; onRemove: (key: string) => void };

function ProductCell({ line }: { line: DraftLine }) {
  const counted = countedLine(line);
  const small = [line.unit ? `Per ${line.unit}` : "Typed line", line.code ? `Item ${line.code}` : null].filter(Boolean).join(", ");
  return (
    <>
      <span className="block text-[16px] font-medium leading-snug text-label">{line.name}</span>
      <span className="mt-0.5 block text-[13px] text-label-2">{small}</span>
      {counted ? <span className="block text-[13px] text-label-2 tnum">{counted}</span> : null}
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

/** One price: the line total inc GST, with what one costs small. */
function Price({ line }: { line: DraftLine }) {
  if (line.qty <= 0) return null;
  const p = linePrice(line.qty, line.price);
  if (!p) return <span className="text-[13px] text-label-2">No price</span>;
  return (
    <span className="block text-[16px] font-medium leading-snug text-label tnum">
      {p.total}
      <span className="block text-[12px] font-normal text-label-2">{p.each}</span>
    </span>
  );
}

function LineTable({ lines, showPrices, onQty, onRemove }: Handlers) {
  return (
    <table className="w-full table-fixed text-left">
      <thead>
        <tr className="text-[12px] font-medium uppercase tracking-wide text-label-2">
          <th scope="col" className="px-4 pb-1 pt-3 font-medium">Product</th>
          <th scope="col" className="w-[204px] px-3 pb-1 pt-3 font-medium">Order</th>
          {showPrices ? <th scope="col" className="w-[124px] px-1 pb-1 pt-3 font-medium">Price</th> : null}
          <th scope="col" className="w-[60px] px-2 pb-1 pt-3"><span className="sr-only">Remove</span></th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.key} className={`border-t border-[color:var(--separator)] align-middle ${l.qty <= 0 ? "opacity-60" : ""}`}>
            <td className="px-4 py-2.5">
              <ProductCell line={l} />
              {l.qty <= 0 ? <span className="mt-1 block text-[13px] font-medium text-label-2">Not ordered</span> : null}
            </td>
            <td className="px-3 py-2.5">
              <QtyControl line={l} onChange={(n) => onQty(l.key, n)} />
              <PackNote line={l} />
            </td>
            {showPrices ? (
              <td className="px-1 py-2.5">
                <Price line={l} />
              </td>
            ) : null}
            <td className="px-2 py-2.5 text-right"><RemoveButton name={l.name} onClick={() => onRemove(l.key)} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LineList({ lines, showPrices, onQty, onRemove }: Handlers) {
  return (
    <ul>
      {lines.map((l) => (
        <li key={l.key} className={`border-t border-[color:var(--separator)] px-4 py-3 first:border-t-0 ${l.qty <= 0 ? "opacity-60" : ""}`}>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <ProductCell line={l} />
            </div>
            <RemoveButton name={l.name} onClick={() => onRemove(l.key)} />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <QtyControl line={l} onChange={(n) => onQty(l.key, n)} />
            {l.qty <= 0 ? (
              <span className="text-[13px] font-medium text-label-2">Not ordered</span>
            ) : showPrices ? (
              <div className="min-w-0 text-right">
                <Price line={l} />
              </div>
            ) : null}
          </div>
          <PackNote line={l} />
        </li>
      ))}
    </ul>
  );
}
