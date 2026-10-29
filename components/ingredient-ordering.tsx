"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { Ingredient } from "@/lib/types";
import {
  addedToast,
  addOrderingProduct,
  changeOrderingProduct,
  loadAllProductsForDefaults,
  loadIngredientOrdering,
  loadOrderingCategories,
  loadVenueProductsForDefaults,
  NO_SUPPLIER_LINE,
  noListSentence,
  orderAgainToast,
  orderDefaults,
  orderedAtSentence,
  orderedDetail,
  parsePar,
  productSetupHref,
  readyPicks,
  resolvePick,
  setOrderingProductActive,
  stoppedToast,
  categoriesOf,
  unitChips,
  unitForCategory,
  venueLinks,
  NO_ORDERING_VENUES,
  type LinkCategory,
  type LinkProduct,
  type LinkTerms,
  type OrderAtPick,
  type VenueLink,
} from "@/lib/ordering-link";
import { VenueMark } from "./brand";
import { TextField, TouchButton, TouchChips, TouchLink, TouchSheet } from "./ordering/touch";
import { Banner, cx, Group, useToast } from "./ui";

/**
 * Ordering on the ingredient page (Troy, 29 Oct 2026: one system; then "make it easier"). One plain switch per venue. ON puts the
 * ingredient on that venue's order list straight away, with a category and order unit worked out from what the venue already orders
 * (lib/ordering-link.ts `orderDefaults`); OFF stops ordering it. When a venue's category cannot be worked out with confidence a
 * small sheet asks for it: a category is never guessed. The supplier is always the ingredient's own supplier: there is no
 * per-venue "order from" choice anywhere here. Every control is 44px at every width (components/ordering/touch.tsx).
 */

type Loaded = { categories: LinkCategory[]; products: LinkProduct[]; terms: LinkTerms[] };

/** A bare iOS-style switch with a 44px tap area. */
function VenueSwitch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex min-h-[44px] min-w-[56px] shrink-0 items-center justify-center disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className={cx("relative inline-flex h-[31px] w-[51px] items-center rounded-full transition-colors duration-200", checked ? "bg-accent-fill" : "bg-fill-2")}>
        <span className={cx("inline-block h-[27px] w-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.16)] transition-transform duration-200 ease-ios", checked ? "translate-x-[22px]" : "translate-x-[2px]")} />
      </span>
    </button>
  );
}

type SheetState = { link: VenueLink; mode: "add"; categoryId: string; unit: string; products: { category_id: string; unit_name: string }[] } | { link: VenueLink; mode: "edit"; product: LinkProduct };

export function IngredientOrdering({ ing }: { ing: Ingredient }) {
  const store = useStore();
  const toast = useToast();
  const sb = useMemo(() => getSupabaseBrowser(), []);
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [sheet, setSheet] = useState<SheetState | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await loadIngredientOrdering(sb, ing.id));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [sb, ing.id]);

  // reload when the ingredient's supplier changes: the database moves its ordering products, so the supplier named here changes too
  useEffect(() => {
    void reload();
  }, [reload, ing.supplier_id]);

  const links = useMemo(() => (data ? venueLinks({ venues: store.venues, ...data }) : []), [data, store.venues]);
  const ingredientCategoryOf = useCallback((id: string) => store.ingredients.find((i) => i.id === id)?.category, [store.ingredients]);
  if (failed && !data) return null;
  if (data && links.length === 0) return null;

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  async function setActive(ids: string[], active: boolean) {
    for (const id of ids) await setOrderingProductActive(sb, id, active);
    await reload();
  }

  async function turnOn(link: VenueLink) {
    setBusy(link.venue.id);
    setError(null);
    try {
      // a product that was stopped comes back instead of a second one being made
      if (link.stopped) {
        const id = link.stopped.product.id;
        await setActive([id], true);
        toast.show({ message: orderAgainToast(ing.name, link.venue.name), action: { label: "Undo", onClick: () => void setActive([id], false).catch(fail) } });
        return;
      }
      const products = await loadVenueProductsForDefaults(sb, link.venue.id);
      const d = orderDefaults({ ingredient: ing, categories: link.categories, products, ingredientCategoryOf });
      if (!d.confident || !d.categoryId) {
        setSheet({ link, mode: "add", categoryId: "", unit: d.unit, products });
        return;
      }
      const r = await addOrderingProduct(sb, { venueId: link.venue.id, ingredientId: ing.id, ingredientName: ing.name, categoryId: d.categoryId, unit: d.unit, par: 0 });
      await reload();
      toast.show({ message: addedToast(link.venue.name, r.supplierName), action: { label: "Undo", onClick: () => void setActive([r.product.id], false).catch(fail) } });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function turnOff(link: VenueLink) {
    const ids = link.active.map((a) => a.product.id);
    setBusy(link.venue.id);
    setError(null);
    try {
      await setActive(ids, false);
      toast.show({ message: stoppedToast(ing.name, link.venue.name), action: { label: "Undo", onClick: () => void setActive(ids, true).catch(fail) } });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Group title="Ordering" className="mt-4" footer={ing.supplier_id ? undefined : NO_SUPPLIER_LINE}>
      {error ? <Banner>{error}</Banner> : null}
      {!data ? <p className="px-4 py-3 text-[15px] text-label-2">Loading order lists…</p> : null}
      {links.map((l) => {
        if (!l.hasList)
          return (
            <div key={l.venue.id} className="flex min-h-[48px] items-center gap-3 px-4 py-2.5 text-label-2">
              <VenueMark slug={l.venue.slug} size={20} />
              <p className="text-[15px] sm:text-[13px]">{noListSentence(l.venue.name)}</p>
            </div>
          );
        const on = l.active.length > 0;
        const first = l.active[0];
        return (
          <div key={l.venue.id} className="flex min-h-[56px] items-center gap-3 px-4 py-1.5">
            <VenueMark slug={l.venue.slug} size={20} />
            <p className="min-w-0 flex-1 text-[17px] leading-snug sm:text-[15px]">
              {on ? (
                <>
                  <span className="font-semibold">{l.venue.name}</span>
                  {`: ${orderedDetail(first)}`}
                </>
              ) : (
                <>
                  <span className="font-semibold">{l.venue.name}</span>
                  <span className="block text-[15px] text-label-2 sm:text-[13px]">{l.stopped ? "Stopped. Switch on to order it again." : "Not ordered here"}</span>
                </>
              )}
            </p>
            {on ? (
              <button type="button" className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl px-2 text-[15px] font-semibold text-accent active:opacity-60" onClick={() => setSheet({ link: l, mode: "edit", product: first.product })}>
                Change
              </button>
            ) : null}
            <VenueSwitch checked={on} disabled={busy === l.venue.id} label={on ? orderedAtSentence(l.venue.name, first) : `Order at ${l.venue.name}`} onChange={(v) => void (v ? turnOn(l) : turnOff(l))} />
          </div>
        );
      })}
      {sheet ? (
        <OrderSheet
          ing={ing}
          state={sheet}
          onClose={() => setSheet(null)}
          onDone={async (message, undo) => {
            setSheet(null);
            await reload();
            toast.show({ message, ...(undo ? { action: { label: "Undo", onClick: () => void undo().then(reload).catch(fail) } } : {}) });
          }}
        />
      ) : null}
    </Group>
  );
}

/** Category, Order Unit and Build To. Shared by the Change sheet and (as far as it needs) the add sheet. */
export function OrderFields({
  ing,
  categories,
  pick,
  onChange,
  onCategory,
  par,
  onParChange,
  parError,
}: {
  ing: Pick<Ingredient, "name" | "pack_unit" | "category">;
  categories: LinkCategory[];
  pick: { categoryId: string; unit: string };
  onChange: (p: { categoryId: string; unit: string }) => void;
  /** the order unit to switch to when the category changes (undefined keeps the unit as it is) */
  onCategory?: (categoryId: string) => string | undefined;
  par?: string;
  onParChange?: (v: string) => void;
  parError?: string | null;
}) {
  const category = categories.find((c) => c.id === pick.categoryId);
  const units = unitChips(ing, category?.unit_name);
  return (
    <div className="space-y-3">
      <div>
        <p className="section-label !px-1">Category</p>
        <TouchChips wrap ariaLabel="Order list category" value={pick.categoryId} onChange={(id) => onChange({ categoryId: id, unit: onCategory?.(id) ?? pick.unit })} options={categories.map((c) => ({ value: c.id, label: c.name }))} />
      </div>
      <div>
        <p className="section-label !px-1">Order Unit</p>
        <TouchChips wrap ariaLabel="Order unit" value={units.includes(pick.unit) ? pick.unit : ""} onChange={(u) => onChange({ ...pick, unit: u })} options={units.map((u) => ({ value: u, label: u }))} />
        <TextField className="!px-0" label="Or type a unit" value={pick.unit} onCommit={(t) => onChange({ ...pick, unit: t.trim() })} onChangeText={(t) => onChange({ ...pick, unit: t })} placeholder="carton" />
      </div>
      {onParChange ? (
        <TextField className="!px-0" label="Build To" value={par ?? ""} onCommit={onParChange} onChangeText={onParChange} inputMode="decimal" placeholder="0" error={parError} hint="The stock level an order brings it back up to." />
      ) : null}
    </div>
  );
}

/** "Change" (edit the product that is on the list) and the add sheet shown only when a category could not be worked out. */
function OrderSheet({ ing, state, onClose, onDone }: { ing: Ingredient; state: SheetState; onClose: () => void; onDone: (message: string, undo?: () => Promise<void>) => void | Promise<void> }) {
  const sb = useMemo(() => getSupabaseBrowser(), []);
  const { link } = state;
  const edit = state.mode === "edit";
  const [pick, setPick] = useState(edit ? { categoryId: state.product.category_id, unit: state.product.unit_name } : { categoryId: state.categoryId, unit: state.unit });
  const [parText, setParText] = useState(edit ? String(state.product.par ?? 0) : "0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const par = parsePar(parText);
  const valid = !!pick.categoryId && !!pick.unit.trim() && par != null && !busy;

  async function save() {
    if (!valid || par == null) return;
    setBusy(true);
    setError(null);
    try {
      if (state.mode === "edit") {
        const before = { category_id: state.product.category_id, unit_name: state.product.unit_name, par: state.product.par ?? 0 };
        await changeOrderingProduct(sb, state.product.id, { category_id: pick.categoryId, unit_name: pick.unit.trim(), par });
        await onDone(`${link.venue.name}'s order list updated`, () => changeOrderingProduct(sb, state.product.id, before));
      } else {
        const r = await addOrderingProduct(sb, { venueId: link.venue.id, ingredientId: ing.id, ingredientName: ing.name, categoryId: pick.categoryId, unit: pick.unit, par });
        await onDone(addedToast(link.venue.name, r.supplierName), () => setOrderingProductActive(sb, r.product.id, false));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <TouchSheet open onClose={onClose} title={edit ? `Change At ${link.venue.name}` : `Order At ${link.venue.name}`} action={{ label: busy ? "Saving…" : edit ? "Save" : "Add", onClick: () => void save(), disabled: !valid }}>
      <div className="space-y-4 pb-2 pt-3">
        {error ? <Banner>{error}</Banner> : null}
        {!edit ? <p className="px-1 text-[15px] text-label-2">Pick the category on {link.venue.name}&apos;s order list. It is ordered from this ingredient&apos;s supplier.</p> : null}
        <OrderFields
          ing={ing}
          categories={link.categories}
          pick={pick}
          onChange={setPick}
          onCategory={state.mode === "add" ? (id) => { const c = link.categories.find((x) => x.id === id); return c ? unitForCategory(ing, c, state.products) : undefined; } : undefined}
          par={parText}
          onParChange={setParText}
          parError={par == null ? "Type a number, like 4." : null}
        />
        <TouchButton variant="primary" className="w-full" disabled={!valid} onClick={() => void save()}>
          {busy ? "Saving…" : edit ? "Save" : `Add To ${link.venue.name}'s Order List`}
        </TouchButton>
        {edit ? (
          <TouchLink variant="text" className="w-full" href={productSetupHref(link.venue.slug, state.product.id)}>
            Open Product Setup
          </TouchLink>
        ) : null}
      </div>
    </TouchSheet>
  );
}

/* ------------------------------------------------------------------ New Ingredient sheet */

/** A venue is on when it has an entry; the entry holds only what the person chose by hand (a category when none could be worked out). */
export type OrderAtState = Record<number, { categoryId?: string; unit?: string }>;

export interface OrderingDefaultsData {
  categories: LinkCategory[];
  products: { venue_id: number; category_id: string; unit_name: string; ingredient_id: string | null }[];
}

/** Loads every venue's categories and products once (for the switches and their defaults). Null until loaded; empty lists when it cannot be read. */
export function useOrderingDefaultsData(enabled = true): OrderingDefaultsData | null {
  const sb = useMemo(() => getSupabaseBrowser(), []);
  const [data, setData] = useState<OrderingDefaultsData | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    Promise.all([loadOrderingCategories(sb), loadAllProductsForDefaults(sb)])
      .then(([categories, products]) => !cancelled && setData({ categories, products }))
      .catch(() => !cancelled && setData({ categories: [], products: [] }));
    return () => {
      cancelled = true;
    };
  }, [sb, enabled]);
  return data;
}

type IngLike = Pick<Ingredient, "name" | "pack_unit" | "category" | "pack_size">;

function defaultsFor(venueId: number, data: OrderingDefaultsData, ing: IngLike, ingredientCategoryOf: (id: string) => string | null | undefined) {
  return orderDefaults({ ingredient: ing, categories: categoriesOf(data.categories, venueId), products: data.products.filter((p) => p.venue_id === venueId), ingredientCategoryOf });
}

/** What each switched-on venue will be created with: the smart default, with any hand choice laid over it. Unfinished ones have no categoryId. */
export function resolveOrderAt(state: OrderAtState, data: OrderingDefaultsData, ing: IngLike, ingredientCategoryOf: (id: string) => string | null | undefined): Partial<OrderAtPick>[] {
  return Object.entries(state).map(([venueId, manual]) => {
    const id = Number(venueId);
    const p = resolvePick(defaultsFor(id, data, ing, ingredientCategoryOf), manual);
    return { venueId: id, categoryId: p.categoryId ?? undefined, unit: p.unit };
  });
}

/**
 * Plain venue switches for the New Ingredient sheet. No category or unit pickers: a switched-on venue shows what it will use. Only a
 * venue with no confident default shows one small category row. Greedy-style venues with no order list show one disabled line;
 * Gelato is not shown. Nothing is created unless a venue is switched on.
 */
export function OrderAtPicker({ ing, data, value, onChange, className }: { ing: IngLike; data: OrderingDefaultsData | null; value: OrderAtState; onChange: (v: OrderAtState) => void; className?: string }) {
  const store = useStore();
  const ingredientCategoryOf = useCallback((id: string) => store.ingredients.find((i) => i.id === id)?.category, [store.ingredients]);
  const venues = useMemo(() => store.venues.filter((v) => !NO_ORDERING_VENUES.includes(v.slug)).sort((a, b) => a.sort - b.sort), [store.venues]);
  if (!data || data.categories.length === 0) return null;

  return (
    <div className={className}>
      <p className="section-label !px-1">Order At</p>
      <div className="group-list">
        {venues.map((v) => {
          const cats = categoriesOf(data.categories, v.id);
          if (cats.length === 0)
            return (
              <div key={v.id} className="flex min-h-[48px] items-center gap-3 px-4 py-2.5 text-label-2">
                <VenueMark slug={v.slug} size={20} />
                <p className="text-[15px] sm:text-[13px]">{noListSentence(v.name)}</p>
              </div>
            );
          const on = !!value[v.id];
          const d = defaultsFor(v.id, data, ing, ingredientCategoryOf);
          const pick = resolvePick(d, value[v.id]);
          const cat = cats.find((c) => c.id === pick.categoryId);
          return (
            <div key={v.id} className="px-4 py-1.5">
              <div className="flex min-h-[48px] items-center gap-3">
                <VenueMark slug={v.slug} size={20} />
                <p className="min-w-0 flex-1 text-[17px] leading-snug sm:text-[15px]">
                  <span className="font-semibold">{v.name}</span>
                  {on && cat ? <span className="block text-[15px] text-label-2 sm:text-[13px]">{`${cat.name}, per ${pick.unit}`}</span> : null}
                </p>
                <VenueSwitch
                  checked={on}
                  label={`Order at ${v.name}`}
                  onChange={(next) => {
                    const copy = { ...value };
                    if (next) copy[v.id] = {};
                    else delete copy[v.id];
                    onChange(copy);
                  }}
                />
              </div>
              {on && !cat ? (
                <div className="pb-2">
                  <p className="px-1 pb-1.5 text-[13px] text-label-2">Pick a category for {v.name}&apos;s order list</p>
                  <TouchChips wrap ariaLabel={`${v.name} category`} value="" onChange={(id) => onChange({ ...value, [v.id]: { ...value[v.id], categoryId: id } })} options={cats.map((c) => ({ value: c.id, label: c.name }))} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="px-1 pt-2 text-[13px] text-label-2">{Object.keys(value).length ? "It is ordered from the supplier you pick above." : "Switch a venue on to put this on its order list. Skip it to add the ingredient on its own."}</p>
    </div>
  );
}

/** Creates the switched-on venues' ordering products for a new ingredient. Never throws: returns what happened per venue so the screen can say it plainly. */
export async function createOrderingForNewIngredient(
  ingredient: { id: string; name: string },
  picks: Partial<OrderAtPick>[],
  venueName: (id: number) => string,
): Promise<{ added: { venue: string; supplierName: string | null }[]; failed: { venue: string; message: string }[]; unfinished: number }> {
  const sb = getSupabaseBrowser();
  const { ready, unfinished } = readyPicks(picks);
  const added: { venue: string; supplierName: string | null }[] = [];
  const failed: { venue: string; message: string }[] = [];
  for (const p of ready) {
    try {
      const r = await addOrderingProduct(sb, { venueId: p.venueId, ingredientId: ingredient.id, ingredientName: ingredient.name, categoryId: p.categoryId, unit: p.unit, par: 0 });
      added.push({ venue: venueName(p.venueId), supplierName: r.supplierName });
    } catch (e) {
      failed.push({ venue: venueName(p.venueId), message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { added, failed, unfinished };
}
