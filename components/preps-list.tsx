"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useStore } from "@/lib/store";
import { indexDoc, search } from "@/lib/search";
import { money, packLabel, unitShort } from "@/lib/format";
import type { PrepCost } from "@/lib/costing";
import { useNewRecipe } from "@/components/new-recipe";
import { useVenue, VenueFilter, VENUE_SHORT } from "@/components/venue";
import { Chips, cx, Empty, Row, SearchField, Segmented } from "@/components/ui";
import { DataTable, type Column } from "@/components/table";

const PAGE = 100;
type Sort = "az" | "cost";

/** The Preps tab of the Ingredients screen. Shared preps (no venue) stay visible under every venue. */
export function PrepsList() {
  const store = useStore();
  const { venue } = useVenue();
  const newRecipe = useNewRecipe();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [sort, setSort] = useState<Sort>("az");
  const [showInactive, setShowInactive] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [q, cat, sort, venue, showInactive]);

  const scoped = useMemo(() => {
    const list = [...store.prepCosts.values()];
    return venue ? list.filter((p) => p.prep.venue_id == null || p.prep.venue_id === venue.id) : list;
  }, [store.prepCosts, venue]);
  const inactiveCount = useMemo(() => scoped.filter((p) => !p.prep.active).length, [scoped]);
  const pool = useMemo(() => (showInactive ? scoped : scoped.filter((p) => p.prep.active)), [scoped, showInactive]);
  const cats = useMemo(() => [...new Set(pool.map((p) => p.prep.prep_type).filter((x): x is string => !!x))].sort(), [pool]);
  useEffect(() => {
    if (cat !== "all" && !cats.includes(cat)) setCat("all");
  }, [cat, cats]);

  const rows = useMemo(() => {
    let list = cat === "all" ? pool : pool.filter((p) => p.prep.prep_type === cat);
    if (q.trim()) {
      const docs = list.map((p) => ({ ...indexDoc({ kind: "prep" as const, id: p.prep.id, title: p.prep.name, sub: "", href: "", extra: p.prep.prep_type ?? "" }), p }));
      return search(docs, q, 500).map((h) => h.doc.p);
    }
    list = [...list];
    if (sort === "cost") list.sort((a, b) => b.costPerUnit - a.costPerUnit);
    else list.sort((a, b) => a.prep.name.localeCompare(b.prep.name));
    return list;
  }, [pool, cat, q, sort]);

  const add = () => newRecipe.open({ venueId: venue?.id ?? null, type: "prep" });

  return (
    <div>
      <VenueFilter className="mb-3" />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchField className="flex-1" value={q} onChange={setQ} placeholder="Search preps" />
        <Segmented
          ariaLabel="Sort"
          size="sm"
          className="lg:w-56"
          value={sort}
          onChange={setSort}
          options={[
            { value: "az", label: "A–Z" },
            { value: "cost", label: "Highest Cost" },
          ]}
        />
      </div>
      {cats.length > 1 ? <Chips className="mt-3" ariaLabel="Prep type" value={cat} onChange={setCat} options={[{ value: "all", label: "All" }, ...cats.map((c) => ({ value: c, label: c }))]} /> : null}

      {rows.length === 0 ? (
        q ? (
          <Empty title="No Results" body={`Nothing matches “${q}”.`} />
        ) : (
          <Empty
            title="No Preps Yet"
            body={venue ? `Add the first prep for ${venue.name}.` : undefined}
            action={
              <button className="btn-primary" onClick={add}>
                <Plus className="h-4 w-4" strokeWidth={2.5} /> New Prep
              </button>
            }
          />
        )
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-3 px-4 pb-1.5 pt-5">
            <p className="text-[13px] text-label-2">
              {rows.length} {rows.length === 1 ? "prep" : "preps"}
            </p>
            {inactiveCount ? (
              <button type="button" className="text-[13px] font-medium text-accent" onClick={() => setShowInactive((x) => !x)}>
                {showInactive ? "Hide Inactive" : `Show Inactive (${inactiveCount})`}
              </button>
            ) : null}
          </div>
          <div className="group-list lg:hidden">
            {rows.slice(0, limit).map((p) => (
              <PrepRow key={p.prep.id} p={p} />
            ))}
          </div>
          <div className="hidden lg:block">
            <PrepTable rows={rows.slice(0, limit)} />
          </div>
          {rows.length > limit ? (
            <button type="button" className="btn-plain mt-3 w-full" onClick={() => setLimit((l) => l + PAGE * 2)}>
              Show More ({rows.length - limit})
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

function PrepTable({ rows }: { rows: PrepCost[] }) {
  const store = useStore();
  const columns: Column<PrepCost>[] = [
    { key: "name", label: "Prep", render: (p) => <span className={cx("font-medium", !p.prep.active && "text-label-2")}>{p.prep.name}</span>, sort: (p) => p.prep.name },
    { key: "type", label: "Type", render: (p) => <span className="text-label-2">{p.prep.prep_type ?? "—"}</span>, sort: (p) => p.prep.prep_type ?? "" },
    { key: "venue", label: "Venue", render: (p) => <span className="text-label-2">{p.prep.venue_id == null ? "Shared" : VENUE_SHORT[store.venueById.get(p.prep.venue_id)?.slug ?? ""] ?? ""}</span> },
    { key: "batch", label: "Batch", align: "right", render: (p) => packLabel(p.prep.yield_qty, p.prep.yield_unit), sort: (p) => Number(p.prep.yield_qty) },
    { key: "unit", label: "Cost per Unit", align: "right", render: (p) => `${money(p.costPerUnit)}/${unitShort(p.prep.yield_unit)}`, sort: (p) => p.costPerUnit },
    { key: "total", label: "Batch Cost", align: "right", render: (p) => <span className="font-semibold">{money(p.batchCost)}</span>, sort: (p) => p.batchCost },
  ];
  return <DataTable rows={rows} columns={columns} rowKey={(p) => p.prep.id} href={(p) => `/preps/${p.prep.id}`} />;
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
