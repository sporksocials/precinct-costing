"use client";

import { useParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { updateProduct, type ProductDraft } from "@/lib/ordering-data";
import { exGst, qtyText } from "@/lib/ordering";
import { bySortThenName, moneyInput, nameTaken, packsSentence, parseMoney, parseQuantity, parseWhole, UNIT_CHOICE_OPTIONS, unitChoice, unitTitle, type UnitChoice } from "@/lib/ordering-setup";
import { Banner, Empty, Group, PageHeader } from "@/components/ui";
import { useOrderingVenue } from "@/components/ordering/venue-context";
import { upsertById, useVenueData } from "@/components/ordering/use-venue-data";
import { ActiveSwitch, ChoiceBlock, SaveNote, TextField, TouchBack, TouchButton, TouchChips, TouchLink } from "@/components/ordering/touch";
import { IngredientPickerSheet, ingredientPackText } from "@/components/ordering/ingredient-picker";

type Save = { state: "idle" | "saving" | "saved" | "error"; message: string | null };

export default function OrderingProductPage() {
  const { id } = useParams<{ id: string }>();
  const { venue, name, base } = useOrderingVenue();
  const store = useStore();
  const { sb, data, status, apply } = useVenueData(venue.id);
  const [save, setSave] = useState<Save>({ state: "idle", message: null });
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [picking, setPicking] = useState(false);
  const [otherUnit, setOtherUnit] = useState<boolean | null>(null);

  const product = data?.products.find((p) => p.id === id) ?? null;
  const categories = useMemo(() => bySortThenName(data?.categories ?? []), [data?.categories]);
  const category = categories.find((c) => c.id === product?.category_id) ?? null;
  const ingredient = product?.ingredient_id ? store.ingredients.find((i) => i.id === product.ingredient_id) ?? null : null;
  const suppliers = useMemo(() => bySortThenName((data?.suppliers ?? []).filter((s) => s.active || s.id === product?.supplier_id)), [data?.suppliers, product?.supplier_id]);
  const setError = (k: string, v: string | null) => setErrors((e) => ({ ...e, [k]: v }));

  const persist = useCallback(
    async (patch: Partial<ProductDraft>): Promise<boolean> => {
      setSave({ state: "saving", message: null });
      try {
        const row = await updateProduct(sb, id, patch);
        apply((d) => ({ ...d, products: upsertById(d.products, row) }));
        setSave({ state: "saved", message: null });
        return true;
      } catch (e) {
        setSave({ state: "error", message: e instanceof Error ? e.message : String(e) });
        return false;
      }
    },
    [sb, id, apply],
  );

  if (!product) {
    return (
      <div className="max-w-2xl lg:pt-6">
        <TouchBack path={`${base}/setup/products`} fallback={`${base}/setup/products`}>
          Products
        </TouchBack>
        {status === "loading" ? <p className="mt-6 text-[15px] text-label-2">Loading...</p> : <Empty title="Product Not Found" body="It may belong to another venue, or have been removed." action={<TouchLink href={`${base}/setup/products`} variant="primary">Back To Products</TouchLink>} />}
      </div>
    );
  }

  const nullable = (t: string) => (t.trim() === "" ? null : t.trim());
  const unitPick: UnitChoice = (otherUnit ?? unitChoice(product.unit_name) === "other") ? "other" : unitChoice(product.unit_name);
  const priceEx = product.price_inc_gst != null ? exGst(Number(product.price_inc_gst)) : null;
  const sentence = ingredient ? packsSentence(product.unit_name, product.price_inc_gst, product.costing_packs_per_unit) : null;

  return (
    <div className="max-w-2xl lg:pt-6">
      <TouchBack path={`${base}/setup/products`} fallback={`${base}/setup/products`}>
        Products
      </TouchBack>
      <PageHeader title={product.name} subtitle={`${name} · ${category?.name ?? "No category"}`} className="lg:!pt-2" />
      <SaveNote state={save.state} message={save.message} />

      <Group title="Product">
        <TextField
          label="Name"
          value={product.name}
          error={errors.name}
          onCommit={(t) => {
            const n = t.trim();
            if (!n) return setError("name", "A product needs a name.");
            if (nameTaken(n, (data?.products ?? []).filter((p) => p.category_id === product.category_id), product.id)) return setError("name", "That category already has a product with that name.");
            setError("name", null);
            void persist({ name: n });
          }}
        />
        <ChoiceBlock label="Category" hint="Moving a product changes where it sits in the count.">
          <TouchChips
            wrap
            ariaLabel="Category"
            value={product.category_id}
            onChange={(cid) => {
              if (cid === product.category_id) return;
              if (nameTaken(product.name, (data?.products ?? []).filter((p) => p.category_id === cid), product.id)) return setError("category", "That category already has a product with this name. Rename it first.");
              setError("category", null);
              const sort = Math.max(0, ...(data?.products ?? []).filter((p) => p.category_id === cid).map((p) => p.sort)) + 1;
              void persist({ category_id: cid, sort });
            }}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
          {errors.category ? (
            <p role="alert" className="mt-2 text-[13px] text-danger">
              {errors.category}
            </p>
          ) : null}
        </ChoiceBlock>
        <ChoiceBlock label="Unit" hint="What is counted and ordered. It shows next to every quantity.">
          <TouchChips
            wrap
            ariaLabel="Unit"
            value={unitPick}
            options={UNIT_CHOICE_OPTIONS}
            onChange={(v) => {
              setOtherUnit(v === "other");
              if (v !== "other") void persist({ unit_name: v });
            }}
          />
          {unitPick === "other" ? (
            <div className="-mx-4 mt-1">
              <TextField label="Unit Name" value={unitChoice(product.unit_name) === "other" ? product.unit_name : ""} placeholder="tray" onCommit={(t) => t.trim() && void persist({ unit_name: t.trim().toLowerCase() })} />
            </div>
          ) : null}
        </ChoiceBlock>
      </Group>

      <Group title="Supplier">
        <ChoiceBlock label="Supplier">
          <TouchChips wrap ariaLabel="Supplier" value={product.supplier_id ?? ""} onChange={(v) => void persist({ supplier_id: v || null })} options={[{ value: "", label: "No Supplier" }, ...suppliers.map((s) => ({ value: s.id, label: s.active ? s.name : `${s.name} (inactive)` }))]} />
        </ChoiceBlock>
        <TextField label="Supplier Item Code" value={product.supplier_item_code ?? ""} placeholder="Star item number" onCommit={(t) => void persist({ supplier_item_code: nullable(t) })} />
        <TextField
          label="Pack Multiple"
          inputMode="numeric"
          value={String(product.pack_multiple)}
          error={errors.pack}
          hint={`Orders round up to a multiple of this. Star spirits come in 6s or 12s. Leave at 1 for ${unitTitle(product.unit_name).toLowerCase() || "unit"}s ordered one at a time.`}
          onCommit={(t) => {
            const v = parseWhole(t, 1);
            if (v == null) return setError("pack", "Type a whole number, 1 or more.");
            setError("pack", null);
            void persist({ pack_multiple: v });
          }}
        />
      </Group>

      <Group title="Price And Build To">
        <TextField
          label="Price Inc GST"
          prefix="$"
          inputMode="decimal"
          value={moneyInput(product.price_inc_gst)}
          suffix={priceEx != null ? `Ex GST $${priceEx.toFixed(2)}` : "Price of one unit"}
          error={errors.price}
          onCommit={(t) => {
            const v = t.trim() === "" ? null : parseMoney(t);
            if (t.trim() !== "" && v == null) return setError("price", "Type an amount like 62.00.");
            setError("price", null);
            void persist({ price_inc_gst: v });
          }}
        />
        <TextField
          label={`Build To (${unitTitle(product.unit_name).toLowerCase() || "units"})`}
          inputMode="numeric"
          value={qtyText(product.par)}
          error={errors.par}
          hint="The stock level an order brings this product back up to. Every change is kept in the Change Log with who made it."
          onCommit={(t) => {
            const v = parseQuantity(t);
            if (v == null) return setError("par", "Type a number, 0 or more.");
            setError("par", null);
            void persist({ par: v });
          }}
        />
      </Group>

      <Group title="Linked Costing Ingredient" footer="Optional. A link lets counts show stock value later. It does not change any costing price.">
        {ingredient ? (
          <div className="px-4 py-3">
            <p className="text-[17px]">{ingredient.name}</p>
            <p className="mt-0.5 text-[13px] text-label-2">{ingredientPackText(ingredient)}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <TouchButton onClick={() => setPicking(true)}>Change Ingredient</TouchButton>
              <TouchButton onClick={() => void persist({ ingredient_id: null, costing_packs_per_unit: null })}>Remove Link</TouchButton>
            </div>
          </div>
        ) : (
          <div className="px-4 py-3">
            <p className="text-[15px] text-label-2">{product.ingredient_id ? "The linked ingredient could not be found." : "Not linked to a costing ingredient."}</p>
            <TouchButton className="mt-3" onClick={() => setPicking(true)}>
              Link An Ingredient
            </TouchButton>
          </div>
        )}
        {ingredient ? (
          <TextField
            label="Packs Per Unit"
            inputMode="decimal"
            value={product.costing_packs_per_unit == null ? "" : qtyText(product.costing_packs_per_unit)}
            error={errors.packs}
            placeholder="24"
            hint={sentence ?? `How many of the ingredient's packs are in one ${product.unit_name || "unit"}, for example 24 cans in a carton.`}
            onCommit={(t) => {
              if (t.trim() === "") {
                setError("packs", null);
                return void persist({ costing_packs_per_unit: null });
              }
              const v = parseQuantity(t);
              if (v == null || v <= 0) return setError("packs", "Type a number above 0, like 24.");
              setError("packs", null);
              void persist({ costing_packs_per_unit: v });
            }}
          />
        ) : null}
      </Group>

      <Group>
        <TextField label="Notes" multiline value={product.notes ?? ""} onCommit={(t) => void persist({ notes: nullable(t) })} />
      </Group>

      <Group>
        <ActiveSwitch checked={product.active} onChange={(v) => void persist({ active: v })} sub="Off takes it off the count and out of new orders. Past counts keep it. Nothing is deleted." />
      </Group>

      <Group title="History">
        <div className="px-4 py-2">
          <TouchLink href={`${base}/history/products/${product.id}`} className="w-full sm:w-auto">
            Counts And Orders For This Product
          </TouchLink>
        </div>
      </Group>

      <IngredientPickerSheet
        open={picking}
        onClose={() => setPicking(false)}
        currentId={product.ingredient_id}
        onPick={(i) => {
          setPicking(false);
          void persist({ ingredient_id: i.id });
        }}
      />
    </div>
  );
}
