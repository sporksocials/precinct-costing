"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { unitWord } from "@/lib/ordering";
import { NO_CARTON_QTY, isCartonUnit, orderFacts, orderPriceSentence } from "@/lib/ordering-facts";
import { useStore } from "@/lib/store";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { Ingredient } from "@/lib/types";
import {
  addedToast,
  addOrderingProduct,
  changeOrderingProduct,
  countedByPlan,
  loadAllProductsForDefaults,
  loadIngredientOrdering,
  loadOrderingCategories,
  loadVenueProductsForDefaults,
  loadVenueUnits,
  NO_SUPPLIER_LINE,
  noListSentence,
  orderAgainToast,
  orderDefaults,
  orderedAtSentence,
  packWord,
  parseCartonQty,
  parseMultiple,
  parsePar,
  productHistoryHref,
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
  type OrderItemPatch,
  type VenueLink,
} from "@/lib/ordering-link";
import { VenueMark } from "./brand";
import { SwitchRow, TextField, TouchButton, TouchChips, TouchLink, TouchSheet } from "./ordering/touch";
import { Banner, cx, Group, useToast } from "./ui";

/**
 * Ordering on the ingredient page: THE ONLY EDITOR of an order item (one card per product, Troy, 23 Nov 2026). An order item
 * is a thin per-venue shell over this ingredient, so everything about the product (its name, supplier, item code, price, how
 * many a carton holds) is this ingredient's and is typed once, here. Per venue there is one plain switch (ON puts the
 * ingredient on that venue's order list with a shelf group and Counted By worked out from what the venue already orders,
 * OFF stops ordering it), then the per-venue things in the open: Category, Counted By, Build To, Order In Multiples Of and a
 * count note, and under them the order price in plain words. Changing Counted By is never a bare tap: it opens ONE sheet that
 * asks for the new Build To in the same step (Build To, the pack multiple and the price all change meaning with the unit).
 * Every control is 44px at every width (components/ordering/touch.tsx).
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

/** One row of the group: the label (and a quiet line under it) on the left, the control on the right. */
function Line({ label, sub, error, children }: { label: string; sub?: React.ReactNode; error?: string | null; children: React.ReactNode }) {
  return (
    <div className="py-1">
      <div className="flex min-h-[48px] items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] text-label">{label}</span>
          {sub ? <span className="block text-[13px] leading-snug text-label-2">{sub}</span> : null}
        </span>
        <span className="flex shrink-0 items-center gap-2">{children}</span>
      </div>
      {error ? (
        <p role="alert" className="pb-1 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A short 44px box that saves when it is left or Enter is pressed (Escape puts the old text back). */
function BoxInput({ value, onCommit, ariaLabel, inputMode = "decimal", width = "w-24", placeholder }: { value: string; onCommit: (text: string) => void; ariaLabel: string; inputMode?: "decimal" | "numeric" | "text"; width?: string; placeholder?: string }) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  return (
    <input
      aria-label={ariaLabel}
      value={text}
      inputMode={inputMode}
      placeholder={placeholder}
      autoComplete="off"
      autoCorrect="off"
      onFocus={() => (focused.current = true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        focused.current = false;
        if (text.trim() !== value.trim()) onCommit(text);
        else setText(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setText(value);
          focused.current = false;
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={cx("h-11 min-h-[44px] rounded-xl bg-fill px-3 text-right text-[17px] text-label outline-none placeholder:text-label-3 focus:bg-surface-2 focus:shadow-[inset_0_0_0_1.5px_var(--accent-fill)]", width)}
    />
  );
}

const changeBtn = "inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl px-2 text-[15px] font-semibold text-accent active:opacity-60";
const numText = (n: number | null | undefined): string => (n == null ? "" : String(Math.round(Number(n) * 100) / 100));

type SheetState =
  | { kind: "add"; link: VenueLink; categoryId: string; unit: string; products: { category_id: string; unit_name: string }[] }
  | { kind: "category"; link: VenueLink; product: LinkProduct }
  | { kind: "counted"; link: VenueLink; product: LinkProduct };

export function IngredientOrdering({ ing }: { ing: Ingredient }) {
  const store = useStore();
  const toast = useToast();
  const sb = useMemo(() => getSupabaseBrowser(), []);
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string | null>>({});
  const root = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);

  const reload = useCallback(async () => {
    try {
      setData(await loadIngredientOrdering(sb, ing.id));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [sb, ing.id]);

  // reload when the ingredient's supplier, name or code changes: the database copies them onto its order items
  useEffect(() => {
    void reload();
  }, [reload, ing.supplier_id, ing.name, ing.supplier_code]);

  // a link from an order screen or the Products list lands here with #ordering: bring the group into view once it has its rows
  useEffect(() => {
    if (scrolled.current || !data || typeof window === "undefined" || window.location.hash !== "#ordering") return;
    scrolled.current = true;
    // instant, like the scroll memory: the page has smooth scrolling on, and a smooth jump is cut short while the page is still filling in
    const go = () => root.current?.scrollIntoView({ block: "start", behavior: "instant" });
    go();
    window.setTimeout(go, 350); // one settling pass: the sections above it load a moment later and push it down (a no-op once the page has gone)
  }, [data]);

  const links = useMemo(() => (data ? venueLinks({ venues: store.venues, ...data }) : []), [data, store.venues]);
  const ingredientCategoryOf = useCallback((id: string) => store.ingredients.find((i) => i.id === id)?.category, [store.ingredients]);
  const factsOpts = useMemo(() => ({ gstRate: store.settings.gst_rate, deals: store.dealsByIngredient.get(ing.id), today: store.today }), [store.settings.gst_rate, store.dealsByIngredient, store.today, ing.id]);
  if (failed && !data) return null;
  if (data && links.length === 0) return null;

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const setErr = (k: string, v: string | null) => setFieldError((m) => ({ ...m, [k]: v }));
  const onLinks = links.filter((l) => l.active.length > 0);
  const anyOn = onLinks.length > 0;
  const pack = packWord(ing, onLinks.map((l) => l.active[0].product.unit_name));
  const cartonSomewhere = onLinks.some((l) => isCartonUnit(l.active[0].product.unit_name));

  async function setActive(ids: string[], active: boolean) {
    for (const id of ids) await setOrderingProductActive(sb, id, active);
    await reload();
  }

  /** One per-venue field: save it, say so, and offer Undo with the value it had. */
  async function saveField(product: LinkProduct, venueName: string, patch: OrderItemPatch, before: OrderItemPatch) {
    setError(null);
    try {
      await changeOrderingProduct(sb, product.id, patch);
      await reload();
      toast.show({ message: `${venueName}'s order list updated`, action: { label: "Undo", onClick: () => void changeOrderingProduct(sb, product.id, before).then(reload).catch(fail) } });
    } catch (e) {
      fail(e);
    }
  }

  /** The ingredient's own facts (how many a carton holds, the supplier's item code): saved like every other field on this page. */
  function saveIngredient(patch: Partial<Ingredient>) {
    setError(null);
    store.updateIngredient(ing.id, patch).catch(fail);
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
        setSheet({ kind: "add", link, categoryId: "", unit: d.unit, products });
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
    <div id="ordering" ref={root} className="scroll-mt-14">
      <Group title="Ordering" className="mt-4" footer={ing.supplier_id ? (anyOn ? "The name, supplier, item code and price on every order come from this ingredient. Nothing is typed twice." : undefined) : NO_SUPPLIER_LINE}>
        {error ? <Banner>{error}</Banner> : null}
        {!data ? <p className="px-4 py-3 text-[15px] text-label-2">Loading order lists…</p> : null}
        {anyOn ? (
          <div className="px-4 py-1">
            <Line
              label="A Carton Holds"
              sub={cartonSomewhere && ing.carton_qty == null ? `${NO_CARTON_QTY}.` : `How many ${unitWord(pack, 2)} come in one carton. Leave it empty if it is not bought by the carton.`}
              error={fieldError.carton}
            >
              <BoxInput
                ariaLabel={`How many ${unitWord(pack, 2)} one carton holds`}
                value={numText(ing.carton_qty)}
                placeholder="Not set"
                onCommit={(t) => {
                  const v = parseCartonQty(t);
                  if (v === undefined) return setErr("carton", "Type a number above 0, like 6.");
                  setErr("carton", null);
                  saveIngredient({ carton_qty: v });
                }}
              />
              <span className="w-16 text-[15px] text-label-2">{unitWord(pack, Number(ing.carton_qty) || 2)}</span>
            </Line>
            <Line label="Supplier Item Code" sub="Printed on every order line. The same code as Supplier Code under Advanced.">
              <BoxInput ariaLabel="Supplier item code" inputMode="text" width="w-36" placeholder="None" value={ing.supplier_code ?? ""} onCommit={(t) => saveIngredient({ supplier_code: t.trim() || null })} />
            </Line>
          </div>
        ) : null}
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
          const p = first?.product;
          const facts = p ? orderFacts({ name: p.name, unit_name: p.unit_name, supplier_item_code: p.supplier_item_code ?? null, price_inc_gst: p.price_inc_gst ?? null, ingredient_id: ing.id }, ing, factsOpts) : null;
          const k = (f: string) => `${l.venue.id}:${f}`;
          return (
            <div key={l.venue.id} className="px-4 py-1.5">
              <div className="flex min-h-[48px] items-center gap-3">
                <VenueMark slug={l.venue.slug} size={20} />
                <p className="min-w-0 flex-1 text-[17px] leading-snug sm:text-[15px]">
                  <span className="font-semibold">{l.venue.name}</span>
                  <span className="block text-[15px] text-label-2 sm:text-[13px]">
                    {on ? (first.supplierName ? `On the ${first.supplierName} order` : "No supplier yet, so it is on no order") : l.stopped ? "Stopped. Switch on to order it again." : "Not ordered here"}
                  </span>
                </p>
                <VenueSwitch checked={on} disabled={busy === l.venue.id} label={on ? orderedAtSentence(l.venue.name, first) : `Order at ${l.venue.name}`} onChange={(v) => void (v ? turnOn(l) : turnOff(l))} />
              </div>
              {on && p ? (
                <div className="pb-2">
                  <Line label="Category" sub="Its shelf group on the count">
                    <span className="max-w-[9rem] truncate text-[15px] text-label-2">{first.categoryName || "None"}</span>
                    <button type="button" className={changeBtn} aria-label={`Change the category at ${l.venue.name}`} onClick={() => setSheet({ kind: "category", link: l, product: p })}>
                      Change
                    </button>
                  </Line>
                  <Line label="Counted By" sub="What is counted and ordered">
                    <span className="max-w-[9rem] truncate text-[15px] capitalize text-label-2">{p.unit_name}</span>
                    <button type="button" className={changeBtn} aria-label={`Change what it is counted by at ${l.venue.name}`} onClick={() => setSheet({ kind: "counted", link: l, product: p })}>
                      Change
                    </button>
                  </Line>
                  <Line label="Build To" sub="The stock level an order brings it back up to" error={fieldError[k("par")]}>
                    <BoxInput
                      ariaLabel={`Build To at ${l.venue.name}`}
                      value={numText(p.par)}
                      onCommit={(t) => {
                        const v = parsePar(t);
                        if (v == null) return setErr(k("par"), "Type a number, like 4.");
                        setErr(k("par"), null);
                        void saveField(p, l.venue.name, { par: v }, { par: p.par ?? 0 });
                      }}
                    />
                    <span className="w-16 truncate text-[15px] text-label-2">{unitWord(p.unit_name, Number(p.par) || 0)}</span>
                  </Line>
                  <Line label="Order In Multiples Of" sub="Orders round up to this. Leave at 1 to order one at a time." error={fieldError[k("multiple")]}>
                    <BoxInput
                      ariaLabel={`Order in multiples of, at ${l.venue.name}`}
                      inputMode="numeric"
                      value={String(p.pack_multiple ?? 1)}
                      onCommit={(t) => {
                        const v = parseMultiple(t);
                        if (v == null) return setErr(k("multiple"), "Type a whole number, 1 or more.");
                        setErr(k("multiple"), null);
                        void saveField(p, l.venue.name, { pack_multiple: v }, { pack_multiple: p.pack_multiple ?? 1 });
                      }}
                    />
                    <span className="w-16 truncate text-[15px] text-label-2">{unitWord(p.unit_name, Number(p.pack_multiple) || 1)}</span>
                  </Line>
                  <TextField className="!px-0 !py-1.5" label="Count Note (Optional)" value={p.notes ?? ""} placeholder="Shown to whoever counts it" onCommit={(t) => void saveField(p, l.venue.name, { notes: t.trim() || null }, { notes: p.notes ?? null })} />
                  {facts ? <p className={cx("pt-1.5 text-[15px] leading-snug", facts.unitInc == null ? "text-warn" : "text-label-2")}>{orderPriceSentence(facts, pack)}</p> : null}
                  <TouchLink variant="text" className="-ml-2 !justify-start !text-[15px]" href={productHistoryHref(l.venue.slug, p.id)}>
                    Counts And Orders At {l.venue.name}
                  </TouchLink>
                </div>
              ) : null}
            </div>
          );
        })}
        {sheet?.kind === "add" ? (
          <AddSheet
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
        {sheet?.kind === "category" ? (
          <CategorySheet
            link={sheet.link}
            product={sheet.product}
            onClose={() => setSheet(null)}
            onPick={(categoryId) => {
              const { product, link } = sheet;
              setSheet(null);
              if (categoryId !== product.category_id) void saveField(product, link.venue.name, { category_id: categoryId }, { category_id: product.category_id });
            }}
          />
        ) : null}
        {sheet?.kind === "counted" ? (
          <CountedBySheet
            ing={ing}
            link={sheet.link}
            product={sheet.product}
            pack={pack}
            onClose={() => setSheet(null)}
            onSave={(patch, before) => {
              const { product, link } = sheet;
              setSheet(null);
              void saveField(product, link.venue.name, patch, before);
            }}
          />
        ) : null}
      </Group>
    </div>
  );
}

/** Category and Counted By chips, and Build To. Used by the add sheet (a venue whose category could not be worked out). */
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
  /** what to count it by when the category changes (undefined keeps it as it is) */
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
        <p className="section-label !px-1">Counted By</p>
        <TouchChips wrap ariaLabel="Counted by" value={units.includes(pick.unit) ? pick.unit : ""} onChange={(u) => onChange({ ...pick, unit: u })} options={units.map((u) => ({ value: u, label: u }))} />
        <TextField className="!px-0" label="Or type a unit" value={pick.unit} onCommit={(t) => onChange({ ...pick, unit: t.trim() })} onChangeText={(t) => onChange({ ...pick, unit: t })} placeholder="carton" />
      </div>
      {onParChange ? (
        <TextField className="!px-0" label="Build To" value={par ?? ""} onCommit={onParChange} onChangeText={onParChange} inputMode="decimal" placeholder="0" error={parError} hint="The stock level an order brings it back up to." />
      ) : null}
    </div>
  );
}

/** Shown only when turning a venue on and its category could not be worked out: pick the category, Counted By and Build To. */
function AddSheet({ ing, state, onClose, onDone }: { ing: Ingredient; state: Extract<SheetState, { kind: "add" }>; onClose: () => void; onDone: (message: string, undo?: () => Promise<void>) => void | Promise<void> }) {
  const sb = useMemo(() => getSupabaseBrowser(), []);
  const { link } = state;
  const [pick, setPick] = useState({ categoryId: state.categoryId, unit: state.unit });
  const [parText, setParText] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const par = parsePar(parText);
  const valid = !!pick.categoryId && !!pick.unit.trim() && par != null && !busy;

  async function save() {
    if (!valid || par == null) return;
    setBusy(true);
    setError(null);
    try {
      const r = await addOrderingProduct(sb, { venueId: link.venue.id, ingredientId: ing.id, ingredientName: ing.name, categoryId: pick.categoryId, unit: pick.unit, par });
      await onDone(addedToast(link.venue.name, r.supplierName), () => setOrderingProductActive(sb, r.product.id, false));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <TouchSheet open onClose={onClose} title={`Order At ${link.venue.name}`} action={{ label: busy ? "Saving…" : "Add", onClick: () => void save(), disabled: !valid }}>
      <div className="space-y-4 pb-2 pt-3">
        {error ? <Banner>{error}</Banner> : null}
        <p className="px-1 text-[15px] text-label-2">Pick the category on {link.venue.name}&apos;s order list. It is ordered from this ingredient&apos;s supplier.</p>
        <OrderFields
          ing={ing}
          categories={link.categories}
          pick={pick}
          onChange={setPick}
          onCategory={(id) => {
            const c = link.categories.find((x) => x.id === id);
            return c ? unitForCategory(ing, c, state.products) : undefined;
          }}
          par={parText}
          onParChange={setParText}
          parError={par == null ? "Type a number, like 4." : null}
        />
        <TouchButton variant="primary" className="w-full" disabled={!valid} onClick={() => void save()}>
          {busy ? "Saving…" : `Add To ${link.venue.name}'s Order List`}
        </TouchButton>
      </div>
    </TouchSheet>
  );
}

/** The shelf group: one tap on a chip saves it (with Undo on the toast). */
function CategorySheet({ link, product, onClose, onPick }: { link: VenueLink; product: LinkProduct; onClose: () => void; onPick: (categoryId: string) => void }) {
  return (
    <TouchSheet open onClose={onClose} title={`Category At ${link.venue.name}`}>
      <div className="space-y-3 pb-2 pt-3">
        <p className="px-1 text-[15px] text-label-2">The shelf group it is counted in at {link.venue.name}. Moving it changes where it sits in the count.</p>
        <TouchChips wrap ariaLabel="Order list category" value={product.category_id} onChange={onPick} options={link.categories.map((c) => ({ value: c.id, label: c.name }))} />
      </div>
    </TouchSheet>
  );
}

/**
 * Changing Counted By. Build To, the pack multiple and the price are all in the counted unit, so the unit is never changed
 * alone: this ONE sheet shows what the change means in words, asks for the new Build To, puts the pack multiple back to 1
 * unless the person keeps it, and saves all three together.
 */
function CountedBySheet({
  ing,
  link,
  product,
  pack,
  onClose,
  onSave,
}: {
  ing: Ingredient;
  link: VenueLink;
  product: LinkProduct;
  pack: string;
  onClose: () => void;
  onSave: (patch: { unit_name: string; par: number; pack_multiple: number }, before: { unit_name: string; par: number; pack_multiple: number }) => void;
}) {
  const store = useStore();
  const sb = useMemo(() => getSupabaseBrowser(), []);
  const [unit, setUnit] = useState(product.unit_name);
  const [parText, setParText] = useState("");
  const [keep, setKeep] = useState(false);
  const [venueUnits, setVenueUnits] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    loadVenueUnits(sb, link.venue.id)
      .then((u) => live && setVenueUnits(u))
      .catch(() => undefined); // the standard chips are enough when the venue's own cannot be read
    return () => {
      live = false;
    };
  }, [sb, link.venue.id]);

  const category = link.categories.find((c) => c.id === product.category_id);
  const chips = unitChips(ing, category?.unit_name, [product.unit_name, ...venueUnits]);
  const multiple = Math.max(1, Number(product.pack_multiple) || 1);
  const next = unit.trim().toLowerCase();
  const plan = countedByPlan({ fromUnit: product.unit_name, toUnit: next, par: product.par ?? 0, packMultiple: multiple, cartonQty: ing.carton_qty });
  const par = parText.trim() === "" ? null : parsePar(parText);
  const valid = !plan.same && par != null;
  const opts = { gstRate: store.settings.gst_rate, deals: store.dealsByIngredient.get(ing.id), today: store.today };
  const facts = (u: string) => orderFacts({ name: product.name, unit_name: u, supplier_item_code: product.supplier_item_code ?? null, price_inc_gst: product.price_inc_gst ?? null, ingredient_id: ing.id }, ing, opts);

  const choose = (u: string) => {
    setUnit(u);
    const p = countedByPlan({ fromUnit: product.unit_name, toUnit: u, par: product.par ?? 0, packMultiple: multiple, cartonQty: ing.carton_qty });
    setParText(p.same || p.suggestedPar == null ? "" : numText(p.suggestedPar));
    setKeep(false);
  };
  const save = () => {
    if (!valid || par == null) return;
    onSave({ unit_name: next, par, pack_multiple: keep ? multiple : 1 }, { unit_name: product.unit_name, par: product.par ?? 0, pack_multiple: multiple });
  };

  return (
    <TouchSheet open onClose={onClose} title={`Counted By At ${link.venue.name}`} action={{ label: "Save", onClick: save, disabled: !valid }}>
      <div className="space-y-4 pb-2 pt-3">
        <p className="px-1 text-[15px] text-label-2">
          Counted by the {product.unit_name.toLowerCase()} now. Build To, the pack multiple and the price are all per {product.unit_name.toLowerCase()}, so they change with it.
        </p>
        <div>
          <p className="section-label !px-1">Counted By</p>
          <TouchChips wrap ariaLabel="Counted by" value={chips.includes(next) ? next : ""} onChange={choose} options={chips.map((u) => ({ value: u, label: u }))} />
          <TextField className="!px-0" label="Or type a unit" value={unit} onCommit={(t) => choose(t.trim())} placeholder="tub" />
        </div>
        {plan.same ? (
          <p className="rounded-xl bg-fill px-4 py-3 text-[15px] text-label-2">Pick what it will be counted by.</p>
        ) : (
          <>
            <div className="space-y-2 rounded-xl bg-warn-soft px-4 py-3 text-[15px] leading-snug text-label" role="status">
              <p className="font-medium">{plan.parSentence}</p>
              <p>
                Now: {orderPriceSentence(facts(product.unit_name), pack)}.
                <br />
                After: {orderPriceSentence(facts(next), pack)}.
              </p>
              <p className="text-label-2">
                Past counts and orders keep the unit they were made with. The last count was by the {product.unit_name.toLowerCase()}, so on the order screen it reads as not counted until it is counted again.
              </p>
            </div>
            <TextField
              className="!px-0"
              label={`New Build To (${unitWord(next, 2)})`}
              value={parText}
              onCommit={setParText}
              onChangeText={setParText}
              inputMode="decimal"
              placeholder="Type a number"
              error={parText.trim() !== "" && par == null ? "Type a number, like 4." : null}
              hint={parText.trim() === "" ? `Type the Build To in ${unitWord(next, 2)} to save.` : `Orders bring it back up to ${parText.trim()} ${unitWord(next, Number(parText) || 0)}.`}
            />
            {plan.multipleSentence ? (
              <div className="group-list">
                <SwitchRow checked={keep} onChange={setKeep} label={`Keep Ordering In Multiples Of ${multiple}`} sub={plan.multipleSentence} />
              </div>
            ) : null}
            <TouchButton variant="primary" className="w-full" disabled={!valid} onClick={save}>
              Count By The {next.charAt(0).toUpperCase() + next.slice(1)}
            </TouchButton>
          </>
        )}
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
                  {on && cat ? <span className="block text-[15px] text-label-2 sm:text-[13px]">{`${cat.name}, counted by the ${pick.unit}`}</span> : null}
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
      <p className="px-1 pt-2 text-[13px] text-label-2">{Object.keys(value).length ? "It is ordered from the supplier you pick above. Set Build To on the ingredient afterwards." : "Switch a venue on to put this on its order list. Skip it to add the ingredient on its own."}</p>
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
