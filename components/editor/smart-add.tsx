"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useStore } from "@/lib/store";
import { ingredientCostPerBase, parsePackFromUom, UNIT_FACTORS, unitBase } from "@/lib/costing";
import { money, unitShort } from "@/lib/format";
import { formatQty, parseLineInput, resolveLineUnit, titleCase } from "@/lib/parse-qty";
import { indexDoc, search, type IndexedDoc } from "@/lib/search";
import type { ComponentType, LineUnit, PackUnit, PortalPrice } from "@/lib/types";
import { blankIngredient, draftFromPortal, IngredientSheet, type IngredientDraft } from "../ingredient-sheet";
import { cx } from "../ui";

export interface AddSpec {
  component_type: ComponentType;
  component_id: string;
  qty: number | null;
  unit: LineUnit;
  adjusted: boolean;
  name: string;
}

interface CompDoc extends IndexedDoc {
  ctype: ComponentType;
  base: PackUnit;
  unitCost: number;
}

interface PortalDoc extends IndexedDoc {
  row: PortalPrice;
  base: PackUnit | null;
  unitCost: number | null;
}

type Suggestion = { t: "comp"; d: CompDoc } | { t: "portal"; d: PortalDoc } | { t: "create"; name: string };

/** Ingredient / prep documents for pickers (active only). */
export function useComponentDocs(excludePrepId?: string): CompDoc[] {
  const store = useStore();
  return useMemo(() => {
    const gst = store.settings.gst_rate;
    const out: CompDoc[] = [];
    for (const i of store.ingredients) {
      if (!i.active) continue;
      const sup = store.supplierById.get(i.supplier_id ?? -1)?.name;
      const unitCost = ingredientCostPerBase(i, gst);
      out.push({
        ...indexDoc({ kind: "ingredient", id: i.id, title: i.name, sub: [sup, unitCost ? `${money(unitCost)}/${unitShort(i.pack_unit)}` : "No price"].filter(Boolean).join(" · "), href: "", extra: `${sup ?? ""} ${i.category ?? ""}` }),
        ctype: "ingredient",
        base: i.pack_unit,
        unitCost,
      });
    }
    for (const p of store.prepCosts.values()) {
      if (!p.prep.active || p.prep.id === excludePrepId) continue;
      out.push({
        ...indexDoc({ kind: "prep", id: p.prep.id, title: p.prep.name, sub: `${money(p.costPerUnit)}/${unitShort(p.prep.yield_unit)}`, href: "", extra: `${p.prep.prep_type ?? ""}`, boost: 0.03 }),
        ctype: "prep",
        base: p.prep.yield_unit,
        unitCost: p.costPerUnit,
      });
    }
    return out;
  }, [store.ingredients, store.prepCosts, store.supplierById, store.settings.gst_rate, excludePrepId]);
}

export function PrepBadge() {
  return <span className="ml-1.5 inline-flex h-[18px] items-center rounded-[5px] bg-accent-soft px-1.5 align-[2px] text-[11px] font-semibold text-accent">Prep</span>;
}

/**
 * "Add ingredient — e.g. 180g chicken thigh". Parses quantity + unit, suggests ingredients and preps,
 * then supplier-catalogue rows, then "Create …". Enter picks the top suggestion.
 */
export function SmartAdd({
  onAdd,
  excludePrepId,
  autoFocus,
  placeholder = "Add ingredient — e.g. 180g chicken thigh",
  onFocusChange,
}: {
  onFocusChange?: (focused: boolean) => void;
  onAdd: (s: AddSpec) => void;
  excludePrepId?: string;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const store = useStore();
  const docs = useComponentDocs(excludePrepId);
  const [text, setText] = useState("");
  const [hi, setHi] = useState(0);
  const [sheet, setSheet] = useState<{ draft: IngredientDraft; title: string; qty: number | null; unit: LineUnit | null } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const parsed = useMemo(() => parseLineInput(text), [text]);
  const query = parsed.query;

  useEffect(() => {
    if (query.length >= 2 && !store.portalPrices) store.loadPortalPrices();
  }, [query, store]);

  const knownCodes = useMemo(() => {
    const s = new Set<string>();
    for (const i of store.ingredients) if (i.supplier_code) s.add(i.supplier_code.toLowerCase());
    return s;
  }, [store.ingredients]);

  const portalDocs = useMemo<PortalDoc[]>(() => {
    if (!store.portalPrices) return [];
    const gst = store.settings.gst_rate;
    return store.portalPrices
      .filter((r) => !(r.product_code && knownCodes.has(r.product_code.toLowerCase())))
      .map((r) => {
        const pack = parsePackFromUom(r.uom);
        const price = Number(r.price) || 0;
        const ex = r.price_inc_gst ? price / (1 + gst) : price;
        const unitCost = pack && pack.pack_size > 0 ? ex / pack.pack_size : null;
        return {
          ...indexDoc({ kind: "portal", id: String(r.id), title: titleCase(r.description ?? ""), sub: `${r.supplier} · ${unitCost != null && pack ? `${money(unitCost)}/${unitShort(pack.pack_unit)}` : money(price)}`, href: "", extra: `${r.supplier} ${r.product_code ?? ""}` }),
          row: r,
          base: pack?.pack_unit ?? null,
          unitCost,
        };
      });
  }, [store.portalPrices, store.settings.gst_rate, knownCodes]);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!query) return [];
    // rank by text match, nudged by whether the typed quantity fits how the item is bought:
    // "2 eggs" (a small count, no unit) favours things bought each; "180g …" favours kg-packed; unpriced items sink
    const countLike = parsed.unit == null && parsed.qty != null && parsed.qty <= 24 && Number.isInteger(parsed.qty);
    const fit = (d: CompDoc) => {
      let x = d.unitCost ? 0 : -0.25;
      if (parsed.unit) x += unitBase(parsed.unit) === d.base ? 0.12 : -0.12;
      else if (countLike) x += d.base === "each" ? 0.35 : -0.15;
      return x;
    };
    const comps = search(docs, query, 14)
      .map((h) => ({ d: h.doc, s: h.score + fit(h.doc) }))
      .sort((x, y) => y.s - x.s)
      .slice(0, 6)
      .map((h) => ({ t: "comp" as const, d: h.d }));
    const portal = portalDocs.length ? search(portalDocs, query, 3).map((h) => ({ t: "portal" as const, d: h.doc })) : [];
    const exact = comps.some((c) => c.d.norm === query.toLowerCase().trim());
    return [...comps, ...portal, ...(exact ? [] : [{ t: "create" as const, name: query }])];
  }, [query, docs, portalDocs, parsed]);

  useEffect(() => setHi(0), [text]);

  function reset() {
    setText("");
    setHi(0);
    inputRef.current?.focus();
  }

  function pick(s: Suggestion) {
    if (s.t === "comp") {
      const r = resolveLineUnit(parsed.unit, s.d.base);
      onAdd({ component_type: s.d.ctype, component_id: s.d.id, qty: parsed.qty, unit: r.unit, adjusted: r.adjusted, name: s.d.title });
      reset();
    } else if (s.t === "portal") {
      setSheet({ draft: draftFromPortal(s.d.row, store.suppliers, store.settings.gst_rate), title: "Add from catalogue", qty: parsed.qty, unit: parsed.unit });
    } else {
      const name = s.name.charAt(0).toUpperCase() + s.name.slice(1);
      const guess: PackUnit = parsed.unit === "ml" || parsed.unit === "L" ? "L" : parsed.unit === "each" ? "each" : "kg";
      setSheet({ draft: blankIngredient({ name, pack_unit: guess }), title: "New ingredient", qty: parsed.qty, unit: parsed.unit });
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!suggestions.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const s = suggestions[hi];
      if (s) pick(s);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setText("");
    }
  }

  // phones: lift the field to the top so suggestions are not hidden by the keyboard
  function onFocus() {
    onFocusChange?.(true);
    if (window.matchMedia("(max-width: 1023px)").matches) {
      window.setTimeout(() => wrapRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 250);
    }
  }

  const preview = (base: PackUnit | null, unitCost: number | null) => {
    if (parsed.qty == null || !base) return null;
    const r = resolveLineUnit(parsed.unit, base);
    const cost = unitCost != null ? parsed.qty * UNIT_FACTORS[r.unit] * unitCost : null;
    return (
      <span className="shrink-0 text-right text-[13px] leading-tight text-label-2 tnum">
        <span className="block">{formatQty(parsed.qty, r.unit)}</span>
        {r.adjusted ? <span className="block text-warn">bought per {unitShort(base)}</span> : cost != null ? <span className="block text-label">{money(cost)}</span> : null}
      </span>
    );
  };

  let firstPortal = true;

  return (
    <div ref={wrapRef} className="scroll-mt-[72px]">
      <div className="flex min-h-[52px] items-center gap-3 px-4 lg:gap-2 lg:pl-2">
        <Plus className="h-5 w-5 shrink-0 text-accent" strokeWidth={2.5} aria-hidden />
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onBlur={() => window.setTimeout(() => onFocusChange?.(false), 150)}
          placeholder={placeholder}
          aria-label="Add ingredient"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="done"
          className="h-[52px] min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-label-2 sm:text-[15px]"
        />
      </div>
      {suggestions.length ? (
        <div role="listbox" aria-label="Suggestions" className="pb-1.5 hairline-t">
          {suggestions.map((s, i) => {
            const on = i === hi;
            const cls = cx("flex min-h-[48px] w-full items-center gap-3 px-4 py-1.5 text-left lg:pl-9", on ? "bg-accent-soft" : "active:bg-fill");
            if (s.t === "comp")
              return (
                <button key={`c${s.d.id}`} role="option" aria-selected={on} type="button" className={cls} onMouseMove={() => setHi(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[17px] sm:text-[15px]">
                      {s.d.title}
                      {s.d.ctype === "prep" ? <PrepBadge /> : null}
                    </span>
                    <span className="block truncate text-[13px] text-label-2">{s.d.sub}</span>
                  </span>
                  {preview(s.d.base, s.d.unitCost)}
                </button>
              );
            if (s.t === "portal") {
              const header = firstPortal;
              firstPortal = false;
              return (
                <React.Fragment key={`p${s.d.id}`}>
                  {header ? <p className="px-4 pb-0.5 pt-2.5 text-[12px] font-medium text-label-2 lg:pl-9">From supplier catalogue</p> : null}
                  <button role="option" aria-selected={on} type="button" className={cls} onMouseMove={() => setHi(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[17px] sm:text-[15px]">{s.d.title}</span>
                      <span className="block truncate text-[13px] text-label-2">{s.d.sub}</span>
                    </span>
                    {preview(s.d.base, s.d.unitCost)}
                  </button>
                </React.Fragment>
              );
            }
            return (
              <button key="create" role="option" aria-selected={on} type="button" className={cx(cls, "text-accent")} onMouseMove={() => setHi(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)}>
                <Plus className="h-4 w-4 shrink-0" strokeWidth={2.5} />
                <span className="truncate text-[17px] sm:text-[15px]">Create “{s.name}”</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {sheet ? (
        <IngredientSheet
          open
          initial={sheet.draft}
          title={sheet.title}
          note={sheet.title === "Add from catalogue" ? "Prefilled from the supplier catalogue. Check the pack size, then add." : undefined}
          onClose={() => setSheet(null)}
          onSaved={(ing) => {
            const r = resolveLineUnit(sheet.unit, ing.pack_unit);
            onAdd({ component_type: "ingredient", component_id: ing.id, qty: sheet.qty, unit: r.unit, adjusted: r.adjusted, name: ing.name });
            setSheet(null);
            reset();
          }}
        />
      ) : null}
    </div>
  );
}
