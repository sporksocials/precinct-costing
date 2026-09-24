"use client";

import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { useStore } from "@/lib/store";
import { ingredientCostPerBase, parsePackFromUom } from "@/lib/costing";
import { gp, money, packLabel, unitShort } from "@/lib/format";
import { indexDoc, search, type IndexedDoc, type SearchDoc, type SearchKind } from "@/lib/search";
import { titleCase } from "@/lib/parse-qty";
import { addRecent, useRecents, type Recent } from "@/lib/recents";
import { VENUE_SHORT } from "./venue";
import { cx, Dot, SearchField, Sheet } from "./ui";

export interface Doc extends IndexedDoc {
  under?: boolean;
  badge?: string;
}

/** Search documents for everything in the store (+ supplier catalogue once loaded). */
export function useSearchDocs(): { core: Doc[]; portal: Doc[] } {
  const store = useStore();
  const core = useMemo(() => {
    const gst = store.settings.gst_rate;
    const docs: Doc[] = [];
    for (const c of store.itemCosts.values()) {
      const v = store.venueById.get(c.item.venue_id);
      docs.push(
        Object.assign(
          indexDoc<SearchDoc>({
            kind: "item",
            id: c.item.id,
            title: c.item.name,
            sub: [VENUE_SHORT[v?.slug ?? ""] ?? v?.name, c.gpPct != null ? `GP ${gp(c.gpPct)}` : "No price"].filter(Boolean).join(" · "),
            href: `/items/${c.item.id}`,
            extra: `${c.item.category} ${c.item.section ?? ""} ${v?.name ?? ""}`,
            boost: c.item.active ? 0.02 : -0.2,
          }),
          { under: c.item.active && c.underTarget },
        ),
      );
    }
    for (const p of store.prepCosts.values()) {
      docs.push(
        indexDoc<SearchDoc>({
          kind: "prep",
          id: p.prep.id,
          title: p.prep.name,
          sub: `Batch ${packLabel(p.prep.yield_qty, p.prep.yield_unit)} · ${money(p.costPerUnit)}/${unitShort(p.prep.yield_unit)}`,
          href: `/preps/${p.prep.id}`,
          extra: `${p.prep.prep_type ?? ""} prep`,
          boost: p.prep.active ? 0 : -0.2,
        }),
      );
    }
    for (const i of store.ingredients) {
      const sup = store.supplierById.get(i.supplier_id ?? -1)?.name;
      docs.push(
        indexDoc<SearchDoc>({
          kind: "ingredient",
          id: i.id,
          title: i.name,
          sub: [sup, `${money(ingredientCostPerBase(i, gst))}/${unitShort(i.pack_unit)}`].filter(Boolean).join(" · "),
          href: `/ingredients/${i.id}`,
          extra: `${sup ?? ""} ${i.category ?? ""} ${i.supplier_code ?? ""}`,
          boost: i.active ? 0 : -0.2,
        }),
      );
    }
    return docs;
  }, [store.itemCosts, store.prepCosts, store.ingredients, store.supplierById, store.venueById, store.settings.gst_rate]);

  const portal = useMemo(() => {
    if (!store.portalPrices) return [];
    return store.portalPrices.map((r) => {
      const pack = parsePackFromUom(r.uom);
      const price = Number(r.price) || 0;
      const per = pack && pack.pack_size > 0 ? `${money(price / pack.pack_size)}/${unitShort(pack.pack_unit)}` : money(price);
      return indexDoc<SearchDoc>({
        kind: "portal",
        id: String(r.id),
        title: titleCase(r.description ?? r.product_code ?? ""),
        sub: `${r.supplier} · ${per}`,
        href: `/portal-prices?q=${encodeURIComponent(titleCase(r.description ?? ""))}`,
        extra: `${r.supplier} ${r.product_code ?? ""} ${r.category ?? ""}`,
        boost: -0.05,
      }) as Doc;
    });
  }, [store.portalPrices]);

  return { core, portal };
}

const GROUPS: { kind: SearchKind; label: string; max: number }[] = [
  { kind: "item", label: "Recipes", max: 6 },
  { kind: "prep", label: "Preps", max: 4 },
  { kind: "ingredient", label: "Ingredients", max: 6 },
  { kind: "portal", label: "Supplier Catalogue", max: 4 },
];

interface ResultRow {
  key: string;
  title: string;
  sub: string;
  href: string;
  kind: SearchKind;
  under?: boolean;
  recent?: boolean;
  id: string;
}

/** Search box + grouped, keyboard-navigable results. Used by the Search tab and the ⌘K palette. */
export function SearchPanel({ autoFocus, onDone, compact }: { autoFocus?: boolean; onDone?: () => void; compact?: boolean }) {
  const router = useRouter();
  const store = useStore();
  const recents = useRecents();
  const { core, portal } = useSearchDocs();
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length >= 2 && !store.portalPrices) store.loadPortalPrices();
  }, [q, store]);

  const groups = useMemo(() => {
    if (!q.trim()) return [] as { label: string; rows: ResultRow[] }[];
    const hits = search(core, q, 80);
    const pHits = portal.length ? search(portal, q, 6) : [];
    return GROUPS.map((g) => ({
      label: g.label,
      rows: (g.kind === "portal" ? pHits : hits.filter((h) => h.doc.kind === g.kind))
        .slice(0, g.max)
        .map((h) => ({ key: `${h.doc.kind}:${h.doc.id}`, title: h.doc.title, sub: h.doc.sub, href: h.doc.href, kind: h.doc.kind, under: (h.doc as Doc).under, id: h.doc.id })),
    })).filter((g) => g.rows.length);
  }, [q, core, portal]);

  const rows: ResultRow[] = useMemo(
    () => (q.trim() ? groups.flatMap((g) => g.rows) : recents.map((r: Recent) => ({ key: `r:${r.kind}:${r.id}`, title: r.title, sub: r.sub, href: r.href, kind: r.kind, recent: true, id: r.id }))),
    [q, groups, recents],
  );

  useEffect(() => setHi(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  const open = useCallback(
    (r: ResultRow) => {
      addRecent({ kind: r.kind, id: r.id, title: r.title, sub: r.sub, href: r.href });
      onDone?.();
      router.push(r.href);
    },
    [router, onDone],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => Math.min(h + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (rows[hi]) open(rows[hi]);
    } else if (e.key === "Escape") {
      if (q) {
        e.preventDefault();
        e.stopPropagation();
        setQ("");
      } else onDone?.();
    }
  };

  let idx = -1;
  const renderRow = (r: ResultRow) => {
    idx += 1;
    const i = idx;
    return (
      <button
        key={r.key}
        type="button"
        data-idx={i}
        onMouseMove={() => setHi(i)}
        onClick={() => open(r)}
        className={cx("flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left", i === hi && !compact ? "bg-fill" : "", compact && i === hi ? "bg-accent-soft" : "", "active:bg-fill")}
      >
        {r.recent ? <Clock className="h-4 w-4 shrink-0 text-label-3" strokeWidth={2.25} /> : null}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] sm:text-[15px]">{r.title}</span>
          <span className="block truncate text-[15px] text-label-2 sm:text-[13px]">{r.sub}</span>
        </span>
        {r.under ? <Dot className="bg-danger" /> : null}
        {r.recent ? <span className="shrink-0 text-[13px] text-label-3">{KIND_LABEL[r.kind]}</span> : null}
      </button>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SearchField value={q} onChange={setQ} autoFocus={autoFocus} onKeyDown={onKeyDown} placeholder="Recipes, preps, ingredients, suppliers" />
      <div ref={listRef} className={cx("min-h-0 flex-1 overflow-y-auto", compact ? "-mx-4 mt-2" : "mt-4")}>
        {!q.trim() ? (
          recents.length ? (
            <section>
              <h2 className="section-label">Recent</h2>
              <div className={cx(compact ? "" : "group-list")}>{rows.map(renderRow)}</div>
            </section>
          ) : (
            <p className="px-4 py-10 text-center text-[15px] text-label-2">Search recipes, preps, ingredients and supplier prices. Typos are fine.</p>
          )
        ) : groups.length === 0 ? (
          <p className="px-4 py-10 text-center text-[15px] text-label-2">No results for “{q.trim()}”</p>
        ) : (
          groups.map((g) => (
            <section key={g.label} className="mb-4">
              <h2 className="section-label">{g.label}</h2>
              <div className={cx(compact ? "" : "group-list")}>{g.rows.map(renderRow)}</div>
            </section>
          ))
        )}
        {q.trim() && !store.portalPrices && !store.portalError ? <p className="px-4 pb-4 text-[13px] text-label-3">Loading supplier catalogue…</p> : null}
      </div>
      {compact ? (
        <div className="-mx-4 -mb-4 mt-1 hidden items-center gap-4 px-4 py-2 text-[12px] text-label-3 hairline-t sm:flex">
          <span>↑↓ to move</span>
          <span>↵ to open</span>
          <span>esc to close</span>
        </div>
      ) : null}
    </div>
  );
}

const KIND_LABEL: Record<SearchKind, string> = { item: "Recipe", prep: "Prep", ingredient: "Ingredient", portal: "Catalogue" };

/** ⌘K / Ctrl+K and "/" command palette. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !typing && !open) {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("precinct-open-search", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("precinct-open-search", onOpen);
    };
  }, [open]);
  return (
    <PaletteSheet open={open} onClose={() => setOpen(false)} />
  );
}

function PaletteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} hideHeader size="lg">
      <div className="flex h-[min(70vh,560px)] flex-col pt-3">
        <SearchPanel autoFocus onDone={onClose} compact />
      </div>
    </Sheet>
  );
}

export function openSearch() {
  window.dispatchEvent(new Event("precinct-open-search"));
}
