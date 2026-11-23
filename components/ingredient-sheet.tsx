"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { exGstEntry, ingredientCostPerBase, parsePackFromUom } from "@/lib/costing";
import { money, packLabel, parseDecimal, unitShort } from "@/lib/format";
import { alreadyExistsText, findSimilarIngredients } from "@/lib/ingredient-duplicates";
import { clashMessage, findClash } from "@/lib/rename";
import { suggestCategory } from "@/lib/ingredient-categories";
import { applyKegHint, looksLikeKeg } from "@/lib/keg";
import { titleCase } from "@/lib/parse-qty";
import { PACK_UNITS, type Ingredient, type PackUnit, type PortalPrice } from "@/lib/types";
import { Banner, cx, Segmented, Sheet, Toggle, useToast } from "./ui";
import { createOrderingForNewIngredient, OrderAtPicker, resolveOrderAt, useOrderingDefaultsData, type OrderAtState } from "./ingredient-ordering";
import { addedToast } from "@/lib/ordering-link";
import { supplierChoices } from "@/lib/suppliers";
import { NameSuggestRow, useNameTidy } from "./name-suggest";
import { CategoryChips } from "./ingredient-category-picker";
import { AddSupplier } from "./add-supplier";

export type IngredientDraft = Omit<Ingredient, "id" | "updated_at">;

/** `cost_ingredients.category` is NOT NULL (default 'Food'); the app must never send an explicit null for it. */
export const DEFAULT_INGREDIENT_CATEGORY = "Food";
/** `cost_ingredients.venues` is NOT NULL (default 'All'); same rule. There is no UI to edit this field yet. */
export const DEFAULT_INGREDIENT_VENUES = "All";

export function blankIngredient(over: Partial<IngredientDraft> = {}): IngredientDraft {
  return {
    name: "",
    category: DEFAULT_INGREDIENT_CATEGORY,
    supplier_id: null,
    supplier_code: null,
    pack_size: 1,
    pack_unit: "kg",
    pack_price: 0,
    price_inc_gst: false,
    gst_free: false,
    rebate: 0,
    yield_pct: 1,
    venues: DEFAULT_INGREDIENT_VENUES,
    active: true,
    last_price_update: null,
    previous_price: null,
    source: "app",
    notes: null,
    ...over,
  };
}

/** Prefill a new ingredient from a supplier catalogue row (price ex GST, pack parsed from the UOM). */
export function draftFromPortal(r: PortalPrice, suppliers: { id: number; name: string }[], gst: number): IngredientDraft {
  const sup = suppliers.find((s) => s.name.toLowerCase() === r.supplier.toLowerCase());
  const pack = parsePackFromUom(r.uom);
  const price = Number(r.price) || 0;
  const ex = r.price_inc_gst ? price / (1 + gst) : price;
  return blankIngredient({
    name: titleCase(r.description ?? ""),
    supplier_id: sup?.id ?? null,
    supplier_code: r.product_code ?? null,
    pack_price: Math.round(ex * 100) / 100,
    price_inc_gst: false,
    pack_size: pack?.pack_size ?? 1,
    pack_unit: pack?.pack_unit ?? "each",
    source: `portal ${r.supplier}${r.batch ? ` · ${r.batch}` : ""}`,
    notes: pack ? null : `Pack "${r.uom ?? ""}" not recognised — check pack size`,
  });
}

/** 44px at every width (the shared .btn shrinks at sm:, so it is not used for these two controls; same as the name suggestion row). */
const TAP = "inline-flex min-h-[44px] min-w-[44px] select-none items-center justify-center rounded-xl px-4 text-[15px] font-semibold transition active:scale-[0.98] active:opacity-80";

/**
 * Compact create-ingredient sheet: name, supplier, pack size + unit, pack price, GST toggle.
 *
 * DUPLICATE GUARD (Troy, 23 Nov 2026; lib/ingredient-duplicates.ts): while the typed name looks like an ingredient that already exists
 * (the same name ignoring the size in brackets, spacing and punctuation), a quiet block under the name lists up to three of them with
 * "Use It" (closes the sheet and hands that ingredient to the caller through `onSaved`, exactly as if it had just been added, with
 * `existing: true`) and one "Add Anyway" (hides the block until the sheet is closed). It never blocks the form. While it shows, the
 * "Did you mean" spelling row is not shown (one block at a time). An identical name is still refused in plain words (`findClash`).
 */
export function IngredientSheet({
  open,
  initial,
  title = "New Ingredient",
  onClose,
  onSaved,
  note,
}: {
  open: boolean;
  initial: IngredientDraft;
  title?: string;
  onClose: () => void;
  /** `existing` is true when the person chose an ingredient that was already there (nothing was created) */
  onSaved: (ing: { id: string; pack_unit: PackUnit; name: string; existing?: boolean }) => void;
  note?: string;
}) {
  const store = useStore();
  const toast = useToast();
  const [orderAt, setOrderAt] = useState<OrderAtState>({});
  const orderingData = useOrderingDefaultsData(open);
  const [f, setF] = useState<IngredientDraft>(initial);
  const [sizeText, setSizeText] = useState(String(initial.pack_size));
  const [priceText, setPriceText] = useState(initial.pack_price ? String(initial.pack_price) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof IngredientDraft>(k: K, v: IngredientDraft[K]) => setF((p) => ({ ...p, [k]: v }));
  const nt = useNameTidy({ kind: "ingredient", value: f.name, setValue: (v) => set("name", v), enabled: open });
  // look-alikes of the typed name, most used first; "Add Anyway" hides them for as long as this sheet is open
  const [addAnyway, setAddAnyway] = useState(false);
  const { ingredients: allIngredients, usedIn } = store;
  const similar = useMemo(() => {
    if (addAnyway || !open || busy) return [];
    const usage = (id: string) => {
      const u = usedIn("ingredient", id);
      return u.items.length + u.preps.length;
    };
    return findSimilarIngredients(f.name, allIngredients, { usage });
  }, [addAnyway, open, busy, f.name, allIngredients, usedIn]);
  // The category is pre-selected from the name as the person types, until they tap a category themselves. With no suggestion it
  // goes back to where the form started. A keg name is left to the keg hint below (it also sets the pack and yield).
  const [categoryTouched, setCategoryTouched] = useState(false);
  const startCategory = useRef(initial.category?.trim() || DEFAULT_INGREDIENT_CATEGORY);
  const suggestion = categoryTouched ? null : suggestCategory({ name: f.name });
  // a name that says keg, on a form still at its blank defaults, becomes a Beer Keg (50 L, 99% yield); done once so the person can still change it
  const kegHinted = useRef(false);
  useEffect(() => {
    if (kegHinted.current) return;
    // a category the form chose for the person (a suggestion from the name) does not count as changed: check the keg hint against where the form started
    const basis = !categoryTouched && f.category !== startCategory.current ? { ...f, category: startCategory.current } : f;
    const hinted = applyKegHint(basis, sizeText);
    if (hinted.draft !== basis) {
      kegHinted.current = true;
      setF(hinted.draft);
      setSizeText(hinted.sizeText);
    }
  }, [f, sizeText, categoryTouched]);
  useEffect(() => {
    if (categoryTouched || kegHinted.current || looksLikeKeg(f.name)) return;
    const target = suggestion ?? startCategory.current;
    if (f.category !== target) setF((p) => ({ ...p, category: target }));
  }, [categoryTouched, suggestion, f.name, f.category]);

  const size = parseDecimal(sizeText) ?? 0;
  // a blank price is allowed (new items are often priced later); text that is not a price is not
  const parsedPrice = priceText.trim() === "" ? 0 : parseDecimal(priceText);
  const price = parsedPrice ?? 0;
  // the typed price may include GST; it is converted and the ingredient is always SAVED ex GST (lib/costing.ts exGstEntry)
  const exPrice = exGstEntry(price, f.price_inc_gst, f.gst_free, store.settings.gst_rate);
  const unitCost = ingredientCostPerBase({ ...f, price_inc_gst: false, pack_size: size, pack_price: exPrice }, store.settings.gst_rate);
  const valid = f.name.trim() && !!f.category?.trim() && size > 0 && parsedPrice != null && !busy;

  async function save() {
    if (!valid) return;
    const name = nt.settle(f.name);
    // an identical name (ignoring capitals and extra spaces) is refused before anything is sent, in plain words
    const clash = findClash(name, store.ingredients, "");
    if (clash) {
      setError(clashMessage("ingredient", clash));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = { ...f, name, pack_size: size, pack_price: exPrice, price_inc_gst: false, last_price_update: new Date().toISOString().slice(0, 10) };
      const id = await store.insertIngredient(payload);
      // nothing is put on an order list unless a venue was ticked; a problem there never undoes the ingredient
      if (Object.keys(orderAt).length && orderingData) {
        const catOf = (iid: string) => store.ingredients.find((i) => i.id === iid)?.category;
        const picks = resolveOrderAt(orderAt, orderingData, { name: payload.name, category: payload.category, pack_unit: payload.pack_unit, pack_size: payload.pack_size }, catOf);
        const r = await createOrderingForNewIngredient({ id, name: payload.name }, picks, (vid) => store.venues.find((v) => v.id === vid)?.name ?? "that venue");
        const parts: string[] = r.added.map((a) => addedToast(a.venue, a.supplierName));
        for (const x of r.failed) parts.push(`Not added to ${x.venue}'s order list. ${x.message}`);
        if (r.unfinished) parts.push("Pick a category for each venue you switched on to add it to an order list.");
        if (parts.length) toast.show({ message: parts.join(" ") }, 8000);
      }
      onSaved({ id, pack_unit: payload.pack_unit, name: payload.name });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/unique|duplicate/i.test(msg) ? `An ingredient called “${f.name.trim()}” already exists.` : msg);
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={title} action={{ label: busy ? "Saving…" : "Add", onClick: () => void save(), disabled: !valid }}>
      <form
        className="space-y-5 pb-2 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error ? <Banner>{error}</Banner> : null}
        {note ? <p className="px-1 text-[13px] text-label-2">{note}</p> : null}
        <input autoFocus={!initial.name} className="field !text-[20px] font-semibold" placeholder="Name" value={f.name} onChange={(e) => set("name", e.target.value)} onFocus={nt.onFocus} onBlur={nt.onBlur} aria-label="Name" />
        {similar.length ? (
          <div role="status" data-duplicate-guard className="!mt-2 rounded-xl bg-warn-soft py-1.5 pl-3.5 pr-1.5">
            {similar.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1">
                <p className="min-w-0 flex-1 basis-[13rem] text-[15px] leading-snug text-label sm:text-[13px]">
                  <span className="break-words font-semibold">{alreadyExistsText(s.name)}</span>
                  <span className="block text-label-2 tnum">
                    {[store.supplierById.get(s.supplier_id ?? -1)?.name ?? "No supplier", `${money(s.pack_price)} per ${packLabel(Number(s.pack_size), s.pack_unit)} pack`].join(" · ")}
                  </span>
                </p>
                <button type="button" className={cx(TAP, "shrink-0 bg-accent-soft text-accent")} onClick={() => onSaved({ id: s.id, pack_unit: s.pack_unit, name: s.name, existing: true })}>
                  Use It
                </button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1">
              <p className="min-w-0 flex-1 basis-[13rem] text-[15px] leading-snug text-label-2 sm:text-[13px]">Only add a new one if it is a different product.</p>
              <button type="button" className={cx(TAP, "shrink-0 bg-surface-2 text-label")} onClick={() => setAddAnyway(true)}>
                Add Anyway
              </button>
            </div>
          </div>
        ) : (
          <NameSuggestRow nt={nt} className="!mt-2" />
        )}
        <div>
          <p className="section-label !px-1">Category</p>
          <CategoryChips
            value={f.category ?? ""}
            extra={startCategory.current}
            onChange={(c) => {
              setCategoryTouched(true);
              set("category", c);
            }}
          />
          {suggestion && f.category === suggestion ? <p className="px-1 pt-2 text-[13px] text-label-2">Suggested from the name</p> : null}
        </div>
        <div>
          <p className="section-label !px-1">Supplier</p>
          <select className="field appearance-none" value={f.supplier_id ?? ""} onChange={(e) => set("supplier_id", e.target.value ? Number(e.target.value) : null)} aria-label="Supplier">
            <option value="">No supplier</option>
            {supplierChoices(store.suppliers, f.supplier_id).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <AddSupplier className="mt-1" onAdded={(s) => set("supplier_id", s.id)} />
        </div>
        <OrderAtPicker ing={{ name: f.name, pack_unit: f.pack_unit, category: f.category, pack_size: size }} data={orderingData} value={orderAt} onChange={setOrderAt} />
        <div>
          <p className="section-label !px-1">Pack</p>
          <div className="flex items-center gap-2">
            <input className="field w-28 text-right tnum" inputMode="decimal" value={sizeText} onChange={(e) => setSizeText(e.target.value)} aria-label="Pack Size" />
            <Segmented ariaLabel="Pack unit" className="flex-1" value={f.pack_unit} onChange={(u) => set("pack_unit", u)} options={PACK_UNITS.map((u) => ({ value: u, label: u === "each" ? "each" : u }))} />
          </div>
        </div>
        <div>
          <p className="section-label !px-1">Pack price</p>
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[17px] text-label-2">$</span>
            <input className="field pl-7 tnum" inputMode="decimal" placeholder="0.00" value={priceText} onChange={(e) => setPriceText(e.target.value)} aria-label="Pack Price" />
          </div>
          <div className="group-list mt-2">
            <Toggle checked={f.price_inc_gst} onChange={(v) => set("price_inc_gst", v)} label="This Price Includes GST" />
          </div>
          {size > 0 && price > 0 ? (
            <p className="px-1 pt-2 text-[13px] text-label-2 tnum">
              {money(unitCost)} per {unitShort(f.pack_unit)} ex GST
            </p>
          ) : null}
        </div>
        <button type="submit" className="btn-primary w-full" disabled={!valid}>
          {busy ? "Saving…" : "Add Ingredient"}
        </button>
      </form>
    </Sheet>
  );
}
