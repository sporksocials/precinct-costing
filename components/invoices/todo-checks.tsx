"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { TouchButton, TouchLink } from "@/components/ordering/touch";
import { useCheckTasks } from "./approve-use-data";
import { taskHeading } from "./check-card";

const SHOWN = 5;

/**
 * To Do > Check These: the odd ones as short task rows (who, which invoice, one plain sentence, one button). Five show, then Show All.
 * Renders nothing while loading, when there is nothing to check, or when the invoice tables cannot be read.
 * `venue` is a venue slug, or null for all venues.
 */
export function ChecksSection({ venue }: { venue: string | null }) {
  const { data } = useCheckTasks(venue);
  const [all, setAll] = useState(false);
  if (!data || data.missing || data.tasks.length === 0) return null;
  const tasks = all ? data.tasks : data.tasks.slice(0, SHOWN);
  const suffix = venue ? `&venue=${venue}` : "";
  return (
    <section aria-labelledby="todo-checks">
      <h2 id="todo-checks" className="px-1 pb-2 text-[22px] font-bold tracking-tight">
        Check These
      </h2>
      <ul className="group-list" aria-label="Things to check">
        {tasks.map((t) => (
          <li key={t.q.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="break-words text-[13px] leading-snug text-label-2">{taskHeading(t)}</p>
              <p className="flex items-start gap-1.5 text-[17px] font-medium leading-snug sm:text-[15px]">
                <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warn" strokeWidth={2.5} />
                <span className="min-w-0 break-words">{t.sentence}</span>
              </p>
            </div>
            <TouchLink href={`/invoices/check?doc=${t.doc.id}${suffix}`} aria-label={`Check invoice ${t.doc.invoice_number ?? ""} from ${t.supplierName}`} className="w-full shrink-0 sm:w-auto">
              Check It
            </TouchLink>
          </li>
        ))}
      </ul>
      {data.tasks.length > SHOWN ? (
        <div className="mt-2">
          <TouchButton variant="text" onClick={() => setAll((v) => !v)} aria-expanded={all}>
            {all ? "Show Fewer" : `Show All ${data.tasks.length}`}
          </TouchButton>
        </div>
      ) : null}
    </section>
  );
}
