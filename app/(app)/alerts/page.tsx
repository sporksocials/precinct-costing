"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import { useStore } from "@/lib/store";
import { priceIncreases, underTargetRows } from "@/lib/insights";
import { parseVirtualItemId } from "@/lib/gelato";
import { gp, money, movePct } from "@/lib/format";
import { useVenue, VenueChips, VENUE_SHORT } from "@/components/venue";
import { Dot, Group, PageHeader, Row } from "@/components/ui";

export default function AlertsPage() {
  const store = useStore();
  const params = useSearchParams();
  const { venue } = useVenue();
  const view = params.get("view");

  const under = useMemo(() => underTargetRows(store.itemCosts.values(), venue?.id ?? null), [store.itemCosts, venue]);
  const itemById = useMemo(() => new Map(store.items.map((i) => [i.id, i])), [store.items]);
  const increases = useMemo(
    () => priceIncreases(store.priceLogs, store.index.ingredients, store.allLines, itemById, store.settings.alert_pct, venue?.id ?? null),
    [store.priceLogs, store.index.ingredients, store.allLines, itemById, store.settings.alert_pct, venue],
  );

  useEffect(() => {
    if (view === "increases") document.getElementById(view)?.scrollIntoView({ block: "start" });
  }, [view]);

  return (
    <div>
      <PageHeader title="Alerts" />
      <VenueChips />

      <section id="under" className="scroll-mt-4">
        <Group title={`Below target GP · ${under.length}`} footer={under.length ? "Suggested price reaches the target GP, rounded up." : undefined}>
          {under.length === 0 ? <Row title="All dishes on target" leading={<Dot className="bg-[color:var(--good)]" />} /> : null}
          {under.map(({ cost: c, flavours }) => {
            const g = parseVirtualItemId(c.item.id);
            return (
            <Row
              key={c.item.id}
              href={`/items/${c.item.id}`}
              title={g ? `${c.item.section ?? c.item.name} · ${flavours} ${flavours === 1 ? "flavour" : "flavours"}` : c.item.name}
              sub={`${venue ? "" : `${VENUE_SHORT[store.venueById.get(c.item.venue_id)?.slug ?? ""] ?? ""} · `}${g ? `Worst: ${c.item.name.split(" - ")[0]} · ` : ""}GP ${gp(c.gpPct)} · target ${gp(c.targetGp, 0)}`}
              trailing={
                <span className="flex flex-col items-end leading-tight tnum">
                  <span className="font-semibold text-label">{money(c.suggestedInc)}</span>
                  <span className="text-[13px] text-label-2">now {money(c.sellInc)}</span>
                </span>
              }
              chevron
            />
            );
          })}
        </Group>
      </section>

      <section id="increases" className="scroll-mt-4">
        <Group title={`Price increases, last 30 days · ${increases.length}`} footer={`Moves over ${gp(store.settings.alert_pct, 0)}, ranked by $ impact across the recipes that use them.`}>
          {increases.length === 0 ? <Row title="No significant increases" /> : null}
          {increases.map((p) => (
            <Row
              key={p.ingredient.id}
              href={`/ingredients/${p.ingredient.id}`}
              title={p.ingredient.name}
              sub={`${p.recipeCount} ${p.recipeCount === 1 ? "recipe" : "recipes"} · ${money(p.log.old_price)} → ${money(p.log.new_price)}`}
              trailing={<span className="font-semibold text-danger">{movePct(p.movePct)}</span>}
              chevron
            />
          ))}
        </Group>
      </section>
    </div>
  );
}
