"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpDown, IceCreamCone, Plus } from "lucide-react";
import { flavourName, isVirtualItemId, virtualItemId } from "@/lib/gelato";
import type { Prep } from "@/lib/types";
import { useStore } from "@/lib/store";
import { indexDoc, search } from "@/lib/search";
import { gp, money, packLabel, unitShort } from "@/lib/format";
import type { ItemCost, PrepCost } from "@/lib/costing";
import { useNewRecipe } from "@/components/new-recipe";
import { useVenue, VenueChips, VENUE_SHORT } from "@/components/venue";
import { Chips, Dot, Empty, Menu, PageHeader, Row, SearchField, Segmented } from "@/components/ui";

type Tab = "items" | "preps";
type Sort = "az" | "gp" | "cost";
const PAGE = 100;

export default function RecipesPage() {
  const store = useStore();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { venue } = useVenue();
  const newRecipe = useNewRecipe();
  const tab: Tab = params.get("type") === "preps" ? "preps" : "items";
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [sort, setSort] = useState<Sort>(params.get("sort") === "gp" ? "gp" : "az");
  const [showInactive, setShowInactive] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    setLimit(PAGE);
  }, [q, cat, sort, tab, venue]);
  useEffect(() => setCat("all"), [tab, venue]);

  const setTab = (t: Tab) => {
    const p = new URLSearchParams(params.toString());
    if (t === "preps") p.set("type", "preps");
    else p.delete("type");
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };

  // ---- menu items
  const itemPool = useMemo(() => {
    let list = [...store.itemCosts.values()].filter((c) => !isVirtualItemId(c.item.id));
    if (venue) list = list.filter((c) => c.item.venue_id === venue.id);
    if (!showInactive) list = list.filter((c) => c.item.active);
    return list;
  }, [store.itemCosts, venue, showInactive]);
  const itemCats = useMemo(() => [...new Set(itemPool.map((c) => c.item.category))].sort(), [itemPool]);

  const items = useMemo(() => {
    let list = cat === "all" ? itemPool : itemPool.filter((c) => c.item.category === cat);
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

  // ---- preps
  const prepPool = useMemo(() => {
    let list = [...store.prepCosts.values()];
    if (venue) list = list.filter((p) => p.prep.venue_id == null || p.prep.venue_id === venue.id);
    if (!showInactive) list = list.filter((p) => p.prep.active);
    return list;
  }, [store.prepCosts, venue, showInactive]);
  const prepCats = useMemo(() => [...new Set(prepPool.map((p) => p.prep.prep_type).filter((x): x is string => !!x))].sort(), [prepPool]);
  const preps = useMemo(() => {
    let list = cat === "all" ? prepPool : prepPool.filter((p) => p.prep.prep_type === cat);
    if (q.trim()) {
      const docs = list.map((p) => ({ ...indexDoc({ kind: "prep" as const, id: p.prep.id, title: p.prep.name, sub: "", href: "", extra: p.prep.prep_type ?? "" }), p }));
      return search(docs, q, 500).map((h) => h.doc.p);
    }
    list = [...list];
    if (sort === "cost") list.sort((a, b) => b.costPerUnit - a.costPerUnit);
    else list.sort((a, b) => a.prep.name.localeCompare(b.prep.name));
    return list;
  }, [prepPool, cat, q, sort]);

  const cats = tab === "items" ? itemCats : prepCats;
  // gelato: in the Gelato venue each flavour is one row (its serves open from there); in All, one link row
  const gelatoVenue = store.gelato.venue;
  const inGelato = tab === "items" && !!gelatoVenue && venue?.id === gelatoVenue.id;
  const showGelato = tab === "items" && !!gelatoVenue && store.gelato.flavours.length > 0 && !venue && !q.trim();
  const flavourRows = useMemo(() => {
    if (!inGelato || (cat !== "all" && cat !== "Gelato")) return [];
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
      return { f, serves: cs.length, worst, under: cs.some((c) => c.underTarget) };
    });
    if (sort === "gp" && !q.trim()) out.sort((a, b) => (a.worst?.gpPct ?? 9) - (b.worst?.gpPct ?? 9));
    return out;
  }, [inGelato, cat, store.gelato, store.itemCosts, showInactive, q, sort]);
  const rows = tab === "items" ? items : preps;
  const total = rows.length + flavourRows.length;

  return (
    <div>
      <PageHeader
        title="Recipes"
        trailing={
          <button type="button" className="btn-primary hidden lg:inline-flex" onClick={() => newRecipe.open({ venueId: venue?.id ?? null, type: tab === "preps" ? "prep" : "item" })}>
            <Plus className="h-4 w-4" strokeWidth={2.5} /> New recipe
          </button>
        }
      />
      <VenueChips />
      <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <Segmented
          ariaLabel="Recipe type"
          className="lg:w-64"
          value={tab}
          onChange={setTab}
          options={[
            { value: "items", label: "Menu items" },
            { value: "preps", label: "Preps" },
          ]}
        />
        <div className="flex flex-1 items-center gap-1">
          <SearchField className="flex-1" value={q} onChange={setQ} placeholder={tab === "items" ? "Search menu items" : "Search preps"} />
          <Menu
            label="Sort"
            trigger={<ArrowUpDown className="h-5 w-5" strokeWidth={2} />}
            items={[
              { label: "A–Z", onClick: () => setSort("az"), checked: sort === "az" },
              ...(tab === "items" ? [{ label: "Lowest GP", onClick: () => setSort("gp"), checked: sort === "gp" }] : []),
              { label: "Highest cost", onClick: () => setSort("cost"), checked: sort === "cost" },
              "sep" as const,
              { label: "Show inactive", onClick: () => setShowInactive((s) => !s), checked: showInactive },
            ]}
          />
        </div>
      </div>
      {cats.length > 1 ? (
        <Chips className="mt-3" ariaLabel="Category" value={cat} onChange={setCat} options={[{ value: "all", label: "All" }, ...cats.map((c) => ({ value: c, label: c }))]} />
      ) : null}

      {total === 0 ? (
        q ? (
          <Empty title="No results" body={`Nothing matches “${q}”.`} />
        ) : (
          <Empty
            title={tab === "items" ? "No recipes yet" : "No preps yet"}
            body={venue ? `Add the first ${tab === "items" ? "menu item" : "prep"} for ${venue.name}.` : undefined}
            action={
              <button className="btn-primary" onClick={() => newRecipe.open({ venueId: venue?.id ?? null, type: tab === "preps" ? "prep" : "item" })}>
                <Plus className="h-4 w-4" strokeWidth={2.5} /> New recipe
              </button>
            }
          />
        )
      ) : (
        <>
          {flavourRows.length ? (
            <>
              <div className="flex items-end justify-between px-4 pb-1.5 pt-5">
                <p className="text-[13px] text-label-2">
                  {flavourRows.length} {flavourRows.length === 1 ? "flavour" : "flavours"} · each sold in {store.gelato.serves.length} serves
                </p>
                <Link href="/gelato" className="text-[13px] font-medium text-accent">
                  All prices
                </Link>
              </div>
              <div className="group-list">
                {flavourRows.map((r) => (
                  <FlavourRow key={r.f.id} f={r.f} serves={r.serves} worst={r.worst} />
                ))}
              </div>
            </>
          ) : null}
          {rows.length ? (
            <p className="px-4 pb-1.5 pt-5 text-[13px] text-label-2">
              {rows.length} {tab === "items" ? (rows.length === 1 ? "menu item" : "menu items") : rows.length === 1 ? "prep" : "preps"}
            </p>
          ) : null}
          {showGelato ? (
            <div className="group-list mb-4">
              <Row
                href="/gelato"
                leading={<IceCreamCone className="h-5 w-5 text-label-2" strokeWidth={2} />}
                title="Gelato Rumba flavours"
                sub={`${store.gelato.flavours.filter((f) => f.active).length} flavours × ${store.gelato.serves.length} serves, priced automatically`}
                chevron
              />
            </div>
          ) : null}
          {rows.length ? (
            <div className="group-list">
              {tab === "items"
                ? (rows as ItemCost[]).slice(0, limit).map((c) => <ItemRow key={c.item.id} c={c} showVenue={!venue} />)
                : (rows as PrepCost[]).slice(0, limit).map((p) => <PrepRow key={p.prep.id} p={p} />)}
            </div>
          ) : null}
          {rows.length > limit ? (
            <button type="button" className="btn-plain mt-3 w-full" onClick={() => setLimit((l) => l + PAGE * 2)}>
              Show more ({rows.length - limit})
            </button>
          ) : null}
        </>
      )}

      <button
        type="button"
        aria-label="New recipe"
        onClick={() => newRecipe.open({ venueId: venue?.id ?? null, type: tab === "preps" ? "prep" : "item" })}
        className="fixed bottom-[calc(66px+env(safe-area-inset-bottom))] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-accent-fill text-accent-on shadow-float transition active:scale-95 lg:hidden"
      >
        <Plus className="h-7 w-7" strokeWidth={2.25} />
      </button>
    </div>
  );
}

function ItemRow({ c, showVenue }: { c: ItemCost; showVenue: boolean }) {
  const store = useStore();
  const v = store.venueById.get(c.item.venue_id);
  const sub = [showVenue ? VENUE_SHORT[v?.slug ?? ""] ?? v?.name : null, c.item.category, `cost ${money(c.costPerPortion)}`].filter(Boolean).join(" · ");
  return (
    <Row
      href={`/items/${c.item.id}`}
      title={c.item.name}
      titleClassName={!c.item.active ? "text-label-2" : undefined}
      sub={sub}
      trailing={
        c.gpPct == null ? (
          <span className="text-label-3">No price</span>
        ) : (
          <>
            {c.underTarget ? <Dot className="bg-danger" /> : null}
            <span className="text-label">{gp(c.gpPct)}</span>
          </>
        )
      }
    />
  );
}

function FlavourRow({ f, serves, worst }: { f: Prep; serves: number; worst: ItemCost | null }) {
  const store = useStore();
  const pc = store.prepCosts.get(f.id);
  return (
    <Row
      href={`/preps/${f.id}`}
      title={flavourName(f)}
      titleClassName={!f.active ? "text-label-2" : undefined}
      sub={[pc ? `Mix ${money(pc.costPerUnit)}/kg` : null, `lowest GP of ${serves} menu serves`].filter(Boolean).join(" · ")}
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

function PrepRow({ p }: { p: PrepCost }) {
  return (
    <Row
      href={`/preps/${p.prep.id}`}
      title={p.prep.name}
      titleClassName={!p.prep.active ? "text-label-2" : undefined}
      sub={`Batch ${packLabel(p.prep.yield_qty, p.prep.yield_unit)} · ${money(p.costPerUnit)}/${unitShort(p.prep.yield_unit)}`}
      trailing={<span className="text-label">{money(p.batchCost)}</span>}
    />
  );
}
