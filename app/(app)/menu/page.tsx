"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Grid3x3, IceCreamCone, Plus, SlidersHorizontal } from "lucide-react";
import { flavourName, isVirtualItemId, virtualItemId } from "@/lib/gelato";
import { beerItemId } from "@/lib/beer";
import type { Prep } from "@/lib/types";
import { useStore } from "@/lib/store";
import { indexDoc, search } from "@/lib/search";
import { gp, money } from "@/lib/format";
import type { ItemCost } from "@/lib/costing";
import { useNewRecipe } from "@/components/new-recipe";
import { useVenue, VenueFilter, VENUE_SHORT } from "@/components/venue";
import { BeerServeSizesSheet, NewBeerSheet } from "@/components/beer-parts";
import { NewFlavourSheet } from "@/components/new-flavour";
import { AddButton, Chips, cx, Dot, Empty, PageHeader, Row, SearchField, Segmented } from "@/components/ui";
import { DataTable, type Column } from "@/components/table";

type Sort = "az" | "gp" | "cost";
const PAGE = 100;
const BEER = "Tap Beer";
const GELATO = "Gelato";

/**
 * Menu: everything sold, in one list. Venue tiles and category chips narrow it; nothing sends you elsewhere.
 * Tap beers are rows under Tap Beer (one per keg). Gelato flavours are rows under Gelato: with the Gelato venue
 * selected, or the Gelato chip. In All with no chip they collapse into one summary row so 40 flavours don't bury the menu.
 */
export default function MenuPage() {
  const store = useStore();
  const params = useSearchParams();
  const { venue, setVenue } = useVenue();
  const newRecipe = useNewRecipe();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState(params.get("cat") ?? "all");
  const [sort, setSort] = useState<Sort>(params.get("sort") === "gp" ? "gp" : "az");
  const [showInactive, setShowInactive] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [sheet, setSheet] = useState<null | "beer" | "beerServes" | "flavour">(null);

  useEffect(() => {
    setLimit(PAGE);
  }, [q, cat, sort, venue]);

  const gelatoVenue = store.gelato.venue;
  const inGelato = !!gelatoVenue && venue?.id === gelatoVenue.id;

  // ---- menu items (dishes and drinks; virtual beer and gelato items are shown as their own rows below)
  const scoped = useMemo(() => {
    let list = [...store.itemCosts.values()].filter((c) => !isVirtualItemId(c.item.id));
    if (venue) list = list.filter((c) => c.item.venue_id === venue.id);
    return list;
  }, [store.itemCosts, venue]);
  const itemPool = useMemo(() => (showInactive ? scoped : scoped.filter((c) => c.item.active)), [scoped, showInactive]);
  const beersHere = useMemo(() => store.beer.beers.filter((b) => !venue || b.venue_id === venue.id), [store.beer.beers, venue]);
  const hasBeers = beersHere.length > 0;
  const hasGelato = store.gelato.flavours.length > 0 && (!venue || inGelato);
  const cats = useMemo(
    () => [...new Set([...itemPool.map((c) => c.item.category), ...(hasBeers ? [BEER] : []), ...(hasGelato ? [GELATO] : [])])].sort(),
    [itemPool, hasBeers, hasGelato],
  );
  // switching venue keeps the chosen category unless the new venue doesn't have it
  useEffect(() => {
    if (cat !== "all" && !cats.includes(cat)) setCat("all");
  }, [cat, cats]);

  const items = useMemo(() => {
    let list = cat === "all" ? itemPool : itemPool.filter((c) => c.item.category === cat);
    if (cat === BEER) list = [];
    if (q.trim()) {
      const docs = list.map((c) => ({ ...indexDoc({ kind: "item" as const, id: c.item.id, title: c.item.name, sub: "", href: "", extra: `${c.item.category} ${c.item.section ?? ""}` }), c }));
      return search(docs, q, 500).map((h) => h.doc.c);
    }
    list = [...list];
    if (sort === "az") list.sort((a, b) => a.item.name.localeCompare(b.item.name));
    if (sort === "gp") list.sort((a, b) => (a.gpPct ?? 9) - (b.gpPct ?? 9));
    if (sort === "cost") list.sort((a, b) => b.costPerPortion - a.costPerPortion);
    return list;
  }, [itemPool, cat, q, sort]);

  // ---- tap beer: one row per beer (its serves live on the beer's page)
  const beerRows = useMemo(() => {
    if (cat !== "all" && cat !== BEER) return [];
    let list = beersHere.filter((b) => showInactive || b.active);
    if (q.trim()) {
      const docs = list.map((b) => ({ ...indexDoc({ kind: "item" as const, id: b.id, title: b.name, sub: "", href: "", extra: "tap beer keg" }), b }));
      list = search(docs, q, 200).map((h) => h.doc.b);
    }
    const out = list.map((b) => {
      const cs = store.beer.serves.map((s) => store.itemCosts.get(beerItemId(b.id, s.id))).filter((c): c is ItemCost => !!c);
      const worst = cs.reduce<ItemCost | null>((w, c) => (c.gpPct != null && (w == null || (w.gpPct ?? 9) > c.gpPct) ? c : w), null);
      return { b, cs, worst };
    });
    if (!q.trim()) {
      if (sort === "gp") out.sort((a, b) => (a.worst?.gpPct ?? 9) - (b.worst?.gpPct ?? 9));
      else out.sort((a, b) => a.b.name.localeCompare(b.b.name));
    }
    return out;
  }, [cat, beersHere, showInactive, q, sort, store.beer.serves, store.itemCosts]);

  // ---- gelato: flavours as rows when the Gelato venue or chip is chosen, or when searching
  const gelatoRows = hasGelato && (inGelato || cat === GELATO || (!venue && !!q.trim() && cat === "all"));
  const flavourRows = useMemo(() => {
    if (!gelatoRows || (cat !== "all" && cat !== GELATO)) return [];
    let list = store.gelato.flavours.filter((f) => showInactive || f.active);
    if (q.trim()) {
      const docs = list.map((f) => ({ ...indexDoc({ kind: "prep" as const, id: f.id, title: flavourName(f), sub: "", href: "", extra: "gelato flavour" }), f }));
      list = search(docs, q, 500).map((h) => h.doc.f);
    }
    const menuServes = store.gelato.serves.filter((sv) => sv.on_menu);
    const serves = menuServes.length ? menuServes : store.gelato.serves;
    const out = list.map((f) => {
      const cs = serves.map((sv) => store.itemCosts.get(virtualItemId(f.id, sv.id))).filter((c): c is ItemCost => !!c);
      const worst = cs.reduce<ItemCost | null>((w, c) => (c.gpPct != null && (w == null || (w.gpPct ?? 9) > c.gpPct) ? c : w), null);
      return { f, serves: cs.length, worst };
    });
    if (sort === "gp" && !q.trim()) out.sort((a, b) => (a.worst?.gpPct ?? 9) - (b.worst?.gpPct ?? 9));
    return out;
  }, [gelatoRows, cat, store.gelato, store.itemCosts, showInactive, q, sort]);
  // All view, nothing else chosen: gelato is a single summary row that opens the Gelato venue
  const gelatoSummary = hasGelato && !venue && cat === "all" && !q.trim();

  const inactiveCount =
    scoped.filter((c) => !c.item.active).length + beersHere.filter((b) => !b.active).length + (hasGelato && (inGelato || cat === GELATO) ? store.gelato.flavours.filter((f) => !f.active).length : 0);
  const rows = items;
  const total = rows.length + flavourRows.length + beerRows.length + (gelatoSummary ? 1 : 0);

  // one add button, whatever you're looking at
  const addKind: "beer" | "flavour" | "item" = cat === BEER ? "beer" : inGelato || cat === GELATO ? "flavour" : "item";
  const addLabel = addKind === "beer" ? "New Tap Beer" : addKind === "flavour" ? "New Flavour" : "New Menu Item";
  const add = () => (addKind === "item" ? newRecipe.open({ venueId: venue?.id ?? null, type: "item" }) : setSheet(addKind));
  const showGelatoTools = flavourRows.length > 0 && (inGelato || cat === GELATO);
  const showBeerTools = cat === BEER;
  const beerDefaultVenue = (venue && venue.slug !== "gelato" ? venue.id : undefined) ?? store.venues.find((v) => v.slug === "drift")?.id ?? store.venues[0]?.id;

  return (
    <div>
      <PageHeader title="Menu" trailing={<AddButton label={addLabel} onClick={add} />} />
      <VenueFilter className="mb-3" />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchField className="flex-1" value={q} onChange={setQ} placeholder="Search the menu" />
        <Segmented
          ariaLabel="Sort"
          size="sm"
          className="lg:w-72"
          value={sort}
          onChange={setSort}
          options={[
            { value: "az", label: "A–Z" },
            { value: "gp", label: "Lowest GP" },
            { value: "cost", label: "Highest Cost" },
          ]}
        />
      </div>
      {cats.length > 1 ? (
        <Chips className="mt-3" ariaLabel="Category" value={cat} onChange={setCat} options={[{ value: "all", label: "All" }, ...cats.map((c) => ({ value: c, label: c }))]} />
      ) : null}

      {total === 0 ? (
        q ? (
          <Empty title="No Results" body={`Nothing matches “${q}”.`} />
        ) : (
          <Empty
            title={addKind === "beer" ? "No Tap Beers Yet" : addKind === "flavour" ? "No Flavours Yet" : "No Menu Items Yet"}
            body={venue ? `Add the first ${addKind === "beer" ? "tap beer" : addKind === "flavour" ? "flavour" : "menu item"} for ${venue.name}.` : undefined}
            action={
              <button className="btn-primary" onClick={add}>
                <Plus className="h-4 w-4" strokeWidth={2.5} /> {addLabel}
              </button>
            }
          />
        )
      ) : (
        <>
          {flavourRows.length ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pb-1.5 pt-5">
                <p className="text-[13px] text-label-2">
                  {flavourRows.length} {flavourRows.length === 1 ? "flavour" : "flavours"} · each sold in {store.gelato.serves.length} serves
                </p>
                {showGelatoTools ? (
                  <div className="flex items-center gap-2">
                    <Link href="/gelato/serves" className="btn-plain !min-h-[34px] !px-3 !text-[13px]">
                      <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={2.25} /> Serves &amp; Sizes
                    </Link>
                    <Link href="/gelato" className="btn-plain !min-h-[34px] !px-3 !text-[13px]">
                      <Grid3x3 className="h-3.5 w-3.5" strokeWidth={2.25} /> Price Grid
                    </Link>
                  </div>
                ) : null}
              </div>
              <div className="group-list">
                {flavourRows.map((r) => (
                  <FlavourRow key={r.f.id} f={r.f} serves={r.serves} worst={r.worst} />
                ))}
              </div>
            </>
          ) : null}
          {beerRows.length ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pb-1.5 pt-5">
                <p className="text-[13px] text-label-2">
                  {beerRows.length} tap {beerRows.length === 1 ? "beer" : "beers"} · {store.beer.serves.map((s) => s.name).join(", ")}
                </p>
                {showBeerTools ? (
                  <button type="button" className="btn-plain !min-h-[34px] !px-3 !text-[13px]" onClick={() => setSheet("beerServes")}>
                    <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={2.25} /> Serve Sizes
                  </button>
                ) : null}
              </div>
              <div className="group-list">
                {beerRows.map(({ b, cs, worst }) => (
                  <Row
                    key={b.id}
                    href={`/beers/${b.id}`}
                    title={<span className={cx(!b.active && "text-label-2")}>{b.name}</span>}
                    sub={[!venue ? VENUE_SHORT[store.venueById.get(b.venue_id)?.slug ?? ""] : null, cs.map((c) => (c.sellInc != null ? money(c.sellInc) : "—")).join(" · ")].filter(Boolean).join(" · ")}
                    trailing={
                      worst?.gpPct != null ? (
                        <span className={cx("flex items-center gap-1.5 font-semibold", worst.underTarget ? "text-danger" : "text-label")}>
                          {worst.underTarget ? <Dot className="bg-danger" /> : null}
                          {gp(worst.gpPct)}
                        </span>
                      ) : null
                    }
                    chevron
                  />
                ))}
              </div>
            </>
          ) : null}
          {gelatoSummary ? (
            <div className="group-list mt-5">
              <Row
                onClick={() => setVenue("gelato")}
                leading={<IceCreamCone className="h-5 w-5 text-label-2" strokeWidth={2} />}
                title="Gelato Rumba Flavours"
                sub={`${store.gelato.flavours.filter((f) => f.active).length} flavours × ${store.gelato.serves.length} serves. Tap to see them.`}
                chevron
              />
            </div>
          ) : null}
          {rows.length || inactiveCount ? (
            <div className="flex items-baseline justify-between gap-3 px-4 pb-1.5 pt-5">
              <p className="text-[13px] text-label-2">{rows.length ? `${rows.length} ${rows.length === 1 ? "menu item" : "menu items"}` : ""}</p>
              {inactiveCount ? (
                <button type="button" className="text-[13px] font-medium text-accent" onClick={() => setShowInactive((x) => !x)}>
                  {showInactive ? "Hide Inactive" : `Show Inactive (${inactiveCount})`}
                </button>
              ) : null}
            </div>
          ) : null}
          {rows.length ? (
            <>
              <div className="group-list lg:hidden">
                {rows.slice(0, limit).map((c) => (
                  <ItemRow key={c.item.id} c={c} showVenue={!venue} />
                ))}
              </div>
              <div className="hidden lg:block">
                <ItemTable rows={rows.slice(0, limit)} showVenue={!venue} sorted={!!q.trim() || sort !== "az"} />
              </div>
            </>
          ) : null}
          {rows.length > limit ? (
            <button type="button" className="btn-plain mt-3 w-full" onClick={() => setLimit((l) => l + PAGE * 2)}>
              Show More ({rows.length - limit})
            </button>
          ) : null}
        </>
      )}

      {sheet === "beer" && beerDefaultVenue != null ? <NewBeerSheet defaultVenueId={beerDefaultVenue} onClose={() => setSheet(null)} /> : null}
      {sheet === "beerServes" ? <BeerServeSizesSheet open onClose={() => setSheet(null)} /> : null}
      {sheet === "flavour" && gelatoVenue ? <NewFlavourSheet venueId={gelatoVenue.id} onClose={() => setSheet(null)} /> : null}
    </div>
  );
}

function itemSub(c: ItemCost, showVenue: boolean, venueName: string | undefined): string {
  const parts = [showVenue ? venueName : null, venueName === c.item.category ? null : c.item.category, `cost ${money(c.costPerPortion)}`];
  return parts.filter(Boolean).join(" · ");
}

function GpCell({ c }: { c: ItemCost }) {
  if (c.gpPct == null) return <span className="text-label-3">No price</span>;
  return (
    <span className="flex flex-col items-end leading-tight">
      <span className={cx("flex items-center gap-1.5 font-semibold", c.underTarget ? "text-danger" : "text-label")}>
        {c.underTarget ? <Dot className="bg-danger" /> : null}
        {gp(c.gpPct)}
      </span>
      <span className="mt-0.5 text-[13px] font-normal text-label-2">{money(c.sellInc)}</span>
    </span>
  );
}

function ItemRow({ c, showVenue }: { c: ItemCost; showVenue: boolean }) {
  const store = useStore();
  const v = store.venueById.get(c.item.venue_id);
  return (
    <Row
      href={`/items/${c.item.id}`}
      title={c.item.name}
      titleClassName={!c.item.active ? "text-label-2" : undefined}
      sub={itemSub(c, showVenue, VENUE_SHORT[v?.slug ?? ""] ?? v?.name)}
      trailing={<GpCell c={c} />}
    />
  );
}

function ItemTable({ rows, showVenue, sorted }: { rows: ItemCost[]; showVenue: boolean; sorted: boolean }) {
  const store = useStore();
  const vName = (c: ItemCost) => {
    const v = store.venueById.get(c.item.venue_id);
    return VENUE_SHORT[v?.slug ?? ""] ?? v?.name ?? "";
  };
  const columns: Column<ItemCost>[] = [
    { key: "name", label: "Menu Item", render: (c) => <span className={cx("font-medium", !c.item.active && "text-label-2")}>{c.item.name}</span>, sort: (c) => c.item.name },
    ...(showVenue
      ? [{ key: "venue", label: "Venue", render: (c: ItemCost) => <span className={cx(`v-${store.venueById.get(c.item.venue_id)?.slug}`, "inline-flex items-center gap-1.5 text-label-2")}><Dot className="bg-accent-fill" />{vName(c)}</span>, sort: vName }]
      : []),
    { key: "cat", label: "Category", render: (c) => <span className="text-label-2">{c.item.category}</span>, sort: (c) => c.item.category },
    { key: "cost", label: "Cost", align: "right", render: (c) => money(c.costPerPortion), sort: (c) => c.costPerPortion },
    { key: "price", label: "Price", align: "right", render: (c) => (c.sellInc != null ? money(c.sellInc) : <span className="text-label-3">—</span>), sort: (c) => c.sellInc },
    { key: "target", label: "Target", align: "right", render: (c) => <span className="text-label-2">{gp(c.targetGp, 0)}</span>, sort: (c) => c.targetGp, hideBelow: "xl" },
    { key: "suggest", label: "Suggested", align: "right", render: (c) => <span className={c.underTarget ? "text-label" : "text-label-3"}>{money(c.suggestedInc)}</span>, sort: (c) => c.suggestedInc, hideBelow: "xl" },
    {
      key: "gp",
      label: "GP",
      align: "right",
      render: (c) =>
        c.gpPct == null ? (
          <span className="text-label-3">No price</span>
        ) : (
          <span className={cx("inline-flex items-center gap-1.5 font-semibold", c.underTarget ? "text-danger" : "text-label")}>
            {c.underTarget ? <Dot className="bg-danger" /> : null}
            {gp(c.gpPct)}
          </span>
        ),
      sort: (c) => c.gpPct,
    },
  ];
  return <DataTable key={sorted ? "s" : "u"} rows={rows} columns={columns} rowKey={(c) => c.item.id} href={(c) => `/items/${c.item.id}`} />;
}

function FlavourRow({ f, serves, worst }: { f: Prep; serves: number; worst: ItemCost | null }) {
  const store = useStore();
  const pc = store.prepCosts.get(f.id);
  return (
    <Row
      href={`/preps/${f.id}`}
      title={flavourName(f)}
      titleClassName={!f.active ? "text-label-2" : undefined}
      sub={[pc ? `Mix ${money(pc.costPerUnit)}/kg` : null, `lowest of ${serves} serves`].filter(Boolean).join(" · ")}
      trailing={
        worst?.gpPct != null ? (
          <>
            {worst.underTarget ? <Dot className="bg-danger" /> : null}
            <span className="text-label">{gp(worst.gpPct)}</span>
          </>
        ) : (
          <span className="text-label-3">No price</span>
        )
      }
      chevron
    />
  );
}

