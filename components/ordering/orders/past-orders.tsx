"use client";

import { useState } from "react";
import { Group, Row } from "@/components/ui";
import { pastOrderRows } from "@/lib/ordering-orders-ui";
import type { OrderingOrder, OrderingSupplier } from "@/lib/ordering-types";
import { StatusPill, btnPlain } from "./parts";

const FIRST = 8;

/** Past Orders: latest first, each with its status, supplier, who and when, linking to the saved order. */
export function PastOrders({ venueSlug, orders, suppliers, nameOf }: { venueSlug: string; orders: readonly OrderingOrder[]; suppliers: readonly OrderingSupplier[]; nameOf: (email: string | null | undefined) => string | null }) {
  const [all, setAll] = useState(false);
  const rows = pastOrderRows(orders, suppliers, nameOf);
  return (
    <Group title="Past Orders" className="mt-8" footer={rows.length ? "Each order keeps the exact text that was sent, who sent it and when." : undefined}>
      {rows.length === 0 ? <p className="px-4 py-4 text-[15px] text-label-2">No orders yet for this venue.</p> : null}
      {(all ? rows : rows.slice(0, FIRST)).map((r) => (
        <Row key={r.id} href={`/ordering/${venueSlug}/orders/${r.id}`} chevron title={`${r.supplierName}, ${r.kindLabel}`} sub={r.when} wrapSub trailing={<StatusPill sent={r.status === "sent"} />} />
      ))}
      {rows.length > FIRST ? (
        <div className="px-4 py-2">
          <button type="button" onClick={() => setAll((a) => !a)} className={btnPlain}>
            {all ? "Show Fewer" : `Show All ${rows.length}`}
          </button>
        </div>
      ) : null}
    </Group>
  );
}
