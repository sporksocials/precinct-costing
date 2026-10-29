"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { useStore } from "@/lib/store";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { Ingredient } from "@/lib/types";
import {
  addedToast,
  addOrderingProduct,
  categoriesOf,
  loadIngredientOrdering,
  loadOrderingCategories,
  NO_SUPPLIER_LINE,
  notOrderedSentence,
  orderAgainToast,
  orderableVenues,
  orderedAtSentence,
  parsePar,
  productSetupHref,
  readyPicks,
  setOrderingProductActive,
  stoppedToast,
  unitChips,
  venueLinks,
  type LinkCategory,
  type LinkProduct,
  type LinkTerms,
  type OrderAtPick,
} from "@/lib/ordering-link";
import { VenueMark } from "./brand";
import { TextField, TouchButton, TouchChips, TouchLink, TouchSheet } from "./ordering/touch";
import { Banner, cx, Group, useToast } from "./ui";

/**
 * Ordering on the ingredient page (Troy, 29 Oct 2026: one system, in every way). For each venue that has an order list: either the
 * product that is ordered there now (with a link to its setup page and a Stop Ordering button), a stopped one (Order Again), or an
 * "Order At <Venue>" button. The product's supplier is the ingredient's supplier; there is nothing to choose on the order side.
 * Every control is 44px at every width (components/ordering/touch.tsx), as on the rest of Ordering.
 */

type Loaded = { categories: LinkCategory[]; products: LinkProduct[]; terms: LinkTerms[] };

export function IngredientOrdering({ ing }: { ing: Ingredient }) {
  const store = useStore();
  const toast = useToast();
  const sb = useMemo(() => getSupabaseBrowser(), []);
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState<number | null>(null);

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
  if (failed && !data) return null;
  if (data && links.length === 0) return null;

  async function toggle(productId: string, venueName: string, active: boolean) {
    setBusy(productId);
    setError(null);
    try {
      await setOrderingProductActive(sb, productId, active);
      await reload();
      toast.show({
        message: active ? orderAgainToast(ing.name, venueName) : stoppedToast(ing.name, venueName),
        action: { label: "Undo", onClick: () => void setOrderingProductActive(sb, productId, !active).then(reload).catch((e) => setError(e instanceof Error ? e.message : String(e))) },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const addingLink = links.find((l) => l.venue.id === adding) ?? null;

  return (
    <Group title="Ordering" className="mt-4" footer={ing.supplier_id ? undefined : NO_SUPPLIER_LINE}>
      {error ? <Banner>{error}</Banner> : null}
      {!data ? <p className="px-4 py-3 text-[15px] text-label-2">Loading order lists…</p> : null}
      {links.map((l) => (
        <div key={l.venue.id} className="px-4 py-3">
          <p className="flex items-start gap-2 text-[17px] leading-snug sm:text-[15px]">
            <VenueMark slug={l.venue.slug} size={20} className="mt-0.5" />
            <span className="min-w-0 flex-1">
              {l.active.length
                ? l.active.map((v) => (
                    <span key={v.product.id} className="block">
                      {orderedAtSentence(l.venue.name, v)}
                    </span>
                  ))
                : l.stopped
                  ? notOrderedSentence(l.venue.name)
                  : <span className="text-label-2">{notOrderedSentence(l.venue.name)}</span>}
            </span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {l.active.map((v) => (
              <span key={v.product.id} className="flex flex-wrap gap-2">
                <TouchLink variant="tinted" href={productSetupHref(l.venue.slug, v.product.id)}>
                  Open Product
                </TouchLink>
                <TouchButton disabled={busy === v.product.id} onClick={() => void toggle(v.product.id, l.venue.name, false)}>
                  Stop Ordering
                </TouchButton>
              </span>
            ))}
            {!l.active.length && l.stopped ? (
              <TouchButton variant="tinted" disabled={busy === l.stopped.product.id} onClick={() => void toggle(l.stopped!.product.id, l.venue.name, true)}>
                Order Again
              </TouchButton>
            ) : null}
            {!l.active.length && !l.stopped ? (
              <TouchButton variant="tinted" onClick={() => setAdding(l.venue.id)}>
                Order At {l.venue.name}
              </TouchButton>
            ) : null}
          </div>
        </div>
      ))}
      {addingLink && data ? (
        <OrderAtSheet
          ing={ing}
          venue={addingLink.venue}
          categories={addingLink.categories}
          onClose={() => setAdding(null)}
          onAdded={async (supplierName) => {
            setAdding(null);
            await reload();
            toast.show({ message: addedToast(addingLink.venue.name, supplierName) });
          }}
        />
      ) : null}
    </Group>
  );
}

/** Category, Order Unit and Build To: the three answers an order list needs. Shared by the page's sheet and the New Ingredient sheet. */
export function OrderFields({
  ing,
  categories,
  pick,
  onChange,
  par,
  onParChange,
  parError,
}: {
  ing: Pick<Ingredient, "name" | "pack_unit" | "category">;
  categories: LinkCategory[];
  pick: { categoryId: string; unit: string };
  onChange: (p: { categoryId: string; unit: string }) => void;
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
        <TouchChips
          wrap
          ariaLabel="Order list category"
          value={pick.categoryId}
          onChange={(id) => {
            const next = categories.find((c) => c.id === id);
            // the unit follows the category until the person has typed their own
            onChange({ categoryId: id, unit: units.includes(pick.unit) || !pick.unit ? (next?.unit_name ?? pick.unit) : pick.unit });
          }}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
        />
      </div>
      <div>
        <p className="section-label !px-1">Order Unit</p>
        <TouchChips wrap ariaLabel="Order unit" value={units.includes(pick.unit) ? pick.unit : ""} onChange={(u) => onChange({ ...pick, unit: u })} options={units.map((u) => ({ value: u, label: u }))} />
        <TextField className="!px-0" label="Or type a unit" value={pick.unit} onCommit={(t) => onChange({ ...pick, unit: t.trim() })} onChangeText={(t) => onChange({ ...pick, unit: t })} placeholder="carton" />
      </div>
      {onParChange ? (
        <TextField className="!px-0" label="Build To" value={par ?? ""} onCommit={onParChange} onChangeText={onParChange} inputMode="decimal" placeholder="0" error={parError} hint="The stock level an order brings it back up to. You can change it later." />
      ) : null}
    </div>
  );
}

function OrderAtSheet({
  ing,
  venue,
  categories,
  onClose,
  onAdded,
}: {
  ing: Ingredient;
  venue: { id: number; name: string; slug: string };
  categories: LinkCategory[];
  onClose: () => void;
  onAdded: (supplierName: string | null) => void | Promise<void>;
}) {
  const sb = useMemo(() => getSupabaseBrowser(), []);
  const first = categories[0];
  const [pick, setPick] = useState({ categoryId: first?.id ?? "", unit: first?.unit_name ?? "carton" });
  const [parText, setParText] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const par = parsePar(parText);
  const valid = !!pick.categoryId && !!pick.unit.trim() && par != null && !busy;

  async function add() {
    if (!valid || par == null) return;
    setBusy(true);
    setError(null);
    try {
      const r = await addOrderingProduct(sb, { venueId: venue.id, ingredientId: ing.id, ingredientName: ing.name, categoryId: pick.categoryId, unit: pick.unit, par });
      await onAdded(r.supplierName);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <TouchSheet open onClose={onClose} title={`Order At ${venue.name}`} action={{ label: busy ? "Adding…" : "Add", onClick: () => void add(), disabled: !valid }}>
      <div className="space-y-4 pb-2 pt-3">
        {error ? <Banner>{error}</Banner> : null}
        <p className="px-1 text-[15px] text-label-2">
          {ing.supplier_id ? `This puts ${ing.name} on ${venue.name}'s order list. It is ordered from the ingredient's supplier.` : NO_SUPPLIER_LINE}
        </p>
        <OrderFields ing={ing} categories={categories} pick={pick} onChange={setPick} par={parText} onParChange={setParText} parError={par == null ? "Type a number, like 4." : null} />
        <TouchButton variant="primary" className="w-full" disabled={!valid} onClick={() => void add()}>
          {busy ? "Adding…" : `Add To ${venue.name}'s Order List`}
        </TouchButton>
      </div>
    </TouchSheet>
  );
}

/* ------------------------------------------------------------------ New Ingredient sheet */

export type OrderAtState = Record<number, { categoryId: string; unit: string }>;

/** "Order At" venue chips for the New Ingredient sheet. Ticking a venue reveals its category and order unit. Nothing is created unless a venue is ticked. */
export function OrderAtPicker({ ing, value, onChange, className }: { ing: Pick<Ingredient, "name" | "pack_unit" | "category">; value: OrderAtState; onChange: (v: OrderAtState) => void; className?: string }) {
  const store = useStore();
  const sb = useMemo(() => getSupabaseBrowser(), []);
  const [categories, setCategories] = useState<LinkCategory[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadOrderingCategories(sb)
      .then((c) => !cancelled && setCategories(c))
      .catch(() => !cancelled && setCategories([]));
    return () => {
      cancelled = true;
    };
  }, [sb]);
  const venues = useMemo(() => (categories ? orderableVenues(store.venues, categories) : []), [categories, store.venues]);
  if (!categories || venues.length === 0) return null;

  function flip(venueId: number) {
    const next = { ...value };
    if (next[venueId]) delete next[venueId];
    else {
      const first = categoriesOf(categories!, venueId)[0];
      next[venueId] = { categoryId: first?.id ?? "", unit: first?.unit_name ?? "carton" };
    }
    onChange(next);
  }

  return (
    <div className={className}>
      <p className="section-label !px-1">Order At</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Order at">
        {venues.map((v) => {
          const on = !!value[v.id];
          return (
            <button
              key={v.id}
              type="button"
              aria-pressed={on}
              onClick={() => flip(v.id)}
              className={cx(
                "inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 text-[15px] font-medium transition active:scale-[0.97]",
                on ? "bg-accent-fill text-accent-on" : "bg-surface text-label shadow-[inset_0_0_0_0.5px_var(--separator)] hover:bg-surface-2",
              )}
            >
              <VenueMark slug={v.slug} size={18} tone="ink" />
              {v.name}
              {on ? <Check aria-hidden className="h-4 w-4" strokeWidth={3} /> : null}
            </button>
          );
        })}
      </div>
      {venues
        .filter((v) => value[v.id])
        .map((v) => (
          <div key={v.id} className="mt-3 rounded-2xl bg-surface-2 p-4">
            <p className="mb-2 text-[15px] font-semibold">{v.name}&apos;s order list</p>
            <OrderFields ing={ing} categories={categoriesOf(categories, v.id)} pick={value[v.id]} onChange={(p) => onChange({ ...value, [v.id]: p })} />
          </div>
        ))}
      <p className="px-1 pt-2 text-[13px] text-label-2">{Object.keys(value).length ? "It is ordered from the supplier you pick above." : "Tick a venue to put this on its order list. Skip it to add the ingredient on its own."}</p>
    </div>
  );
}

/** Creates the ticked venues' ordering products for a new ingredient. Never throws: returns what happened per venue so the screen can say it plainly. */
export async function createOrderingForNewIngredient(
  ingredient: { id: string; name: string },
  state: OrderAtState,
  venueName: (id: number) => string,
): Promise<{ added: { venue: string; supplierName: string | null }[]; failed: { venue: string; message: string }[]; unfinished: number }> {
  const sb = getSupabaseBrowser();
  const picks = Object.entries(state).map(([venueId, p]) => ({ venueId: Number(venueId), ...p }));
  const { ready, unfinished } = readyPicks(picks);
  const added: { venue: string; supplierName: string | null }[] = [];
  const failed: { venue: string; message: string }[] = [];
  for (const p of ready as OrderAtPick[]) {
    try {
      const r = await addOrderingProduct(sb, { venueId: p.venueId, ingredientId: ingredient.id, ingredientName: ingredient.name, categoryId: p.categoryId, unit: p.unit, par: 0 });
      added.push({ venue: venueName(p.venueId), supplierName: r.supplierName });
    } catch (e) {
      failed.push({ venue: venueName(p.venueId), message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { added, failed, unfinished };
}
