"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { ingredientCostPerBase, parsePackFromUom } from "@/lib/costing";
import { money, parseDecimal, unitShort } from "@/lib/format";
import { titleCase } from "@/lib/parse-qty";
import { PACK_UNITS, type Ingredient, type PackUnit, type PortalPrice } from "@/lib/types";
import { Banner, Segmented, Sheet, Toggle } from "./ui";

export type IngredientDraft = Omit<Ingredient, "id" | "updated_at">;

export function blankIngredient(over: Partial<IngredientDraft> = {}): IngredientDraft {
  return {
    name: "",
    category: null,
    supplier_id: null,
    supplier_code: null,
    pack_size: 1,
    pack_unit: "kg",
    pack_price: 0,
    price_inc_gst: false,
    gst_free: false,
    rebate: 0,
    yield_pct: 1,
    venues: null,
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
    category: null,
    pack_price: Math.round(ex * 100) / 100,
    price_inc_gst: false,
    pack_size: pack?.pack_size ?? 1,
    pack_unit: pack?.pack_unit ?? "each",
    source: `portal ${r.supplier}${r.batch ? ` · ${r.batch}` : ""}`,
    notes: pack ? null : `Pack "${r.uom ?? ""}" not recognised — check pack size`,
  });
}

/** Compact create-ingredient sheet: name, supplier, pack size + unit, pack price, GST toggle. */
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
  onSaved: (ing: { id: string; pack_unit: PackUnit; name: string }) => void;
  note?: string;
}) {
  const store = useStore();
  const [f, setF] = useState<IngredientDraft>(initial);
  const [sizeText, setSizeText] = useState(String(initial.pack_size));
  const [priceText, setPriceText] = useState(initial.pack_price ? String(initial.pack_price) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof IngredientDraft>(k: K, v: IngredientDraft[K]) => setF((p) => ({ ...p, [k]: v }));

  const size = parseDecimal(sizeText) ?? 0;
  // a blank price is allowed (new items are often priced later); text that is not a price is not
  const parsedPrice = priceText.trim() === "" ? 0 : parseDecimal(priceText);
  const price = parsedPrice ?? 0;
  const unitCost = ingredientCostPerBase({ ...f, pack_size: size, pack_price: price }, store.settings.gst_rate);
  const valid = f.name.trim() && size > 0 && parsedPrice != null && !busy;

  async function save() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const payload = { ...f, name: f.name.trim(), pack_size: size, pack_price: price, last_price_update: new Date().toISOString().slice(0, 10) };
      const id = await store.insertIngredient(payload);
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
        <input autoFocus={!initial.name} className="field !text-[20px] font-semibold" placeholder="Name" value={f.name} onChange={(e) => set("name", e.target.value)} aria-label="Name" />
        <div>
          <p className="section-label !px-1">Supplier</p>
          <select className="field appearance-none" value={f.supplier_id ?? ""} onChange={(e) => set("supplier_id", e.target.value ? Number(e.target.value) : null)} aria-label="Supplier">
            <option value="">No supplier</option>
            {store.suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
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
            <Toggle checked={f.price_inc_gst} onChange={(v) => set("price_inc_gst", v)} label="Price Includes GST" />
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
