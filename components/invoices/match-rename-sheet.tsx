"use client";

import { ArrowRight } from "lucide-react";
import { linkedCount, type BatchRenamePlan } from "@/lib/invoice-match-save";
import type { Venue } from "@/lib/types";
import { TouchButton, TouchSheet } from "@/components/ordering/touch";

/**
 * "Rename 14 Items?": shown once, before anything is saved, when any item will take its invoice name. It lists each ingredient's
 * old and new name, then the dishes and ordering products named after them that follow (the same rules as renaming one ingredient).
 * Rename All saves the matches then the names; Only Save The Matches saves the matches and leaves every name alone.
 */
export function RenameSheet({ plan, venues, onChoose, onClose }: { plan: BatchRenamePlan; venues: Venue[]; onChoose: (plan: BatchRenamePlan | null) => void; onClose: () => void }) {
  const venueName = (id: number | null) => venues.find((v) => v.id === id)?.name ?? "";
  const n = plan.ingredients.length;
  const linked = linkedCount(plan);
  return (
    <TouchSheet open onClose={onClose} title={`Rename ${n} ${n === 1 ? "Item" : "Items"}?`} action={{ label: "Rename All", onClick: () => onChoose(plan) }} size="lg">
      <div className="space-y-5 pb-2">
        <p className="text-[15px] leading-snug text-label-2">
          {linked > 0
            ? `These items take the name on the invoice. ${linked} ${linked === 1 ? "name" : "names"} that follow them change too, so the dishes, the ordering lists and the ingredients all agree. Undo Renames puts every name back.`
            : "These items take the name on the invoice. Undo Renames puts every name back."}
        </p>
        <Section title="Ingredients" rows={plan.ingredients.map((r) => ({ key: r.key, where: "", from: r.from, to: r.to }))} />
        {plan.dishes.length > 0 ? <Section title="Dishes" rows={plan.dishes.map((d) => ({ key: d.id, where: venueName(d.venue_id), from: d.from, to: d.to }))} /> : null}
        {plan.products.length > 0 ? (
          <Section title="Ordering Products" rows={plan.products.map((p) => ({ key: p.id, where: venueName(p.venue_id), from: p.from, to: p.to, note: p.link ? "Also linked to this ingredient" : undefined }))} />
        ) : null}
        {plan.skipped.length > 0 ? (
          <div>
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-label-3">Left As They Are</h3>
            <ul className="mt-1.5 space-y-1.5">
              {plan.skipped.map((s) => (
                <li key={`${s.kind}${s.from}${s.venue_id}`} className="text-[15px] text-label-2">
                  {s.from}
                  {s.venue_id != null ? ` (${venueName(s.venue_id)})` : ""}: {s.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          <TouchButton variant="primary" className="w-full" onClick={() => onChoose(plan)}>
            Rename All
          </TouchButton>
          <TouchButton variant="tinted" className="w-full" onClick={() => onChoose(null)}>
            Only Save The Matches
          </TouchButton>
        </div>
      </div>
    </TouchSheet>
  );
}

function Section({ title, rows }: { title: string; rows: { key: string; where: string; from: string; to: string; note?: string }[] }) {
  return (
    <div>
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-label-3">
        {title} ({rows.length})
      </h3>
      <ul className="mt-1.5 max-h-[34vh] divide-y divide-[color:var(--separator)] overflow-y-auto rounded-2xl bg-fill px-3.5">
        {rows.map((r) => (
          <li key={r.key} className="py-2.5">
            {r.where ? <p className="text-[12px] font-medium text-label-3">{r.where}</p> : null}
            <p className="break-words text-[15px] text-label-2 line-through decoration-label-3">{r.from}</p>
            <p className="flex items-start gap-1.5 break-words text-[16px] font-medium text-label">
              <ArrowRight aria-hidden className="mt-1 h-4 w-4 shrink-0 text-accent" strokeWidth={2.25} />
              <span>{r.to}</span>
            </p>
            {r.note ? <p className="mt-0.5 text-[12px] text-label-3">{r.note}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
