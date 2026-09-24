"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import { useStore } from "@/lib/store";
import { priceIncreases, underTargetRows, type UnderRow } from "@/lib/insights";
import { DataTable } from "@/components/table";
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

  const titleOf = (r: UnderRow) => {
    const g = parseVirtualItemId(r.cost.item.id);
    if (!g) return r.cost.item.name;
    const flavour = r.cost.item.name.split(" - ")[0];
    return `${r.cost.item.section} · ${r.flavours > 1 ? `${flavour} and ${r.flavours - 1} more` : flavour}`;
  };
  const venueOf = (r: UnderRow) => VENUE_SHORT[store.venueById.get(r.cost.item.venue_id)?.slug ?? ""] ?? "";

  useEffect(() => {
    if (view === "increases") document.getElementById(view)?.scrollIntoView({ block: "start" });
  }, [view]);

  return (
    <div>
      <PageHeader title="Alerts" />
      <VenueChips />

      <section id="under" className="scroll-mt-4">
        <Group
          title={`Below target GP · ${under.length}`}
          className="lg:hidden"
          footer={under.length ? "Suggested price reaches the target GP, rounded up. Gelato serves show the flavour furthest off." : undefined}
        >
          {under.length === 0 ? <Row title="Everything is on target" leading={<Dot className="bg-[color:var(--good)]" />} /> : null}
          {under.map((r) => (
            <Row
              key={r.cost.item.id}
              href={`/items/${r.cost.item.id}`}
              title={titleOf(r)}
              sub={`${venue ? "" : `${venueOf(r)} · `}GP ${gp(r.cost.gpPct)} · target ${gp(r.cost.targetGp, 0)}`}
              trailing={
                <span className="flex flex-col items-end leading-tight tnum">
                  <span className="font-semibold text-label">
                    <span className="mr-1 text-[12px] font-normal text-label-2">Suggest</span>
                    {money(r.cost.suggestedInc)}
                  </span>
                  <span className="mt-0.5 text-[13px] text-label-2">now {money(r.cost.sellInc)}</span>
                </span>
              }
              chevron
            />
          ))}
        </Group>
        <div className="mt-6 hidden lg:block">
          <div className="flex items-end justify-between px-4 pb-1.5">
            <h2 className="text-[13px] font-medium text-label-2">Below target GP · {under.length}</h2>
          </div>
          {under.length ? (
            <DataTable
              rows={under}
              rowKey={(r) => r.cost.item.id}
              href={(r) => `/items/${r.cost.item.id}`}
              columns={[
                { key: "name", label: "Item", render: (r) => <span className="font-medium">{titleOf(r)}</span>, sort: (r) => titleOf(r) },
                ...(venue ? [] : [{ key: "venue", label: "Venue", render: (r: UnderRow) => <span className="text-label-2">{venueOf(r)}</span>, sort: venueOf }]),
                { key: "gp", label: "GP", align: "right", render: (r) => <span className="font-semibold text-danger">{gp(r.cost.gpPct)}</span>, sort: (r) => r.cost.gpPct },
                { key: "target", label: "Target", align: "right", render: (r) => <span className="text-label-2">{gp(r.cost.targetGp, 0)}</span>, sort: (r) => r.cost.targetGp },
                { key: "now", label: "Price now", align: "right", render: (r) => money(r.cost.sellInc), sort: (r) => r.cost.sellInc },
                { key: "sugg", label: "Suggested", align: "right", render: (r) => <span className="font-semibold">{money(r.cost.suggestedInc)}</span>, sort: (r) => r.cost.suggestedInc },
                {
                  key: "diff",
                  label: "Change",
                  align: "right",
                  render: (r) => <span className="text-label-2">+{money(r.cost.suggestedInc - (r.cost.sellInc ?? 0))}</span>,
                  sort: (r) => r.cost.suggestedInc - (r.cost.sellInc ?? 0),
                },
              ]}
            />
          ) : (
            <div className="group-list">
              <Row title="Everything is on target" leading={<Dot className="bg-[color:var(--good)]" />} />
            </div>
          )}
          {under.length ? <p className="px-4 pt-1.5 text-[13px] text-label-2">Suggested price reaches the target GP, rounded up. Gelato serves show the flavour furthest off.</p> : null}
        </div>
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
