"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { updateProduct } from "@/lib/ordering-data";
import { qtyText } from "@/lib/ordering";
import { orderPriceSentence } from "@/lib/ordering-facts";
import { NEEDS_INGREDIENT, NEEDS_INGREDIENT_HREF, ingredientOrderingHref } from "@/lib/ordering-orders-ui";
import { unitTitle } from "@/lib/ordering-setup";
import { Empty, Group, PageHeader } from "@/components/ui";
import { useOrderingVenue } from "@/components/ordering/venue-context";
import { upsertById, useVenueData } from "@/components/ordering/use-venue-data";
import { useOrderFacts } from "@/components/ordering/use-order-facts";
import { ActiveSwitch, SaveNote, TouchBack, TouchLink } from "@/components/ordering/touch";

type Save = { state: "idle" | "saving" | "saved" | "error"; message: string | null };

/** One read-only fact on the fallback card. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-[48px] items-center justify-between gap-3 px-4 py-2">
      <span className="text-[15px] text-label-2">{label}</span>
      <span className="min-w-0 truncate text-right text-[17px] text-label">{value}</span>
    </div>
  );
}

/**
 * A product's own page no longer edits anything (one card per product, Troy, 23 Nov 2026): a product is its ingredient, so
 * this address sends the person on to the ingredient page with the Ordering group in view. The only product that stays here
 * is an OLD one with no ingredient (or whose ingredient cannot be found): it gets a small read-only card with what is
 * stored on it, its Active switch, and "Needs An Ingredient".
 */
export default function OrderingProductPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { venue, name, base } = useOrderingVenue();
  const store = useStore();
  const factsOf = useOrderFacts();
  const { sb, data, status, apply } = useVenueData(venue.id);
  const [save, setSave] = useState<Save>({ state: "idle", message: null });

  const product = data?.products.find((p) => p.id === id) ?? null;
  const category = data?.categories.find((c) => c.id === product?.category_id) ?? null;
  const supplier = data?.suppliers.find((s) => s.id === product?.supplier_id) ?? null;
  const ingredientFound = !!product?.ingredient_id && store.ingredients.some((i) => i.id === product.ingredient_id);
  const goTo = product?.ingredient_id && ingredientFound ? ingredientOrderingHref(product.ingredient_id) : null;

  useEffect(() => {
    if (goTo) router.replace(goTo);
  }, [goTo, router]);

  const setActive = useCallback(
    async (active: boolean) => {
      setSave({ state: "saving", message: null });
      try {
        const row = await updateProduct(sb, id, { active });
        apply((d) => ({ ...d, products: upsertById(d.products, row) }));
        setSave({ state: "saved", message: null });
      } catch (e) {
        setSave({ state: "error", message: e instanceof Error ? e.message : String(e) });
      }
    },
    [sb, id, apply],
  );

  const back = (
    <TouchBack path={`${base}/setup/products`} fallback={`${base}/setup/products`}>
      Products
    </TouchBack>
  );

  if (!product) {
    return (
      <div className="max-w-2xl lg:pt-6">
        {back}
        {status === "loading" ? <p className="mt-6 text-[15px] text-label-2">Loading...</p> : <Empty title="Product Not Found" body="It may belong to another venue, or have been removed." action={<TouchLink href={`${base}/setup/products`} variant="primary">Back To Products</TouchLink>} />}
      </div>
    );
  }

  // wait for the ingredient list before deciding an ingredient is missing, so a slow load never shows the fallback card by mistake
  if (product.ingredient_id && (ingredientFound || !store.ready)) {
    return (
      <div className="max-w-2xl lg:pt-6">
        {back}
        <p className="mt-6 text-[15px] text-label-2">Opening the ingredient...</p>
        {ingredientFound ? (
          <TouchLink href={ingredientOrderingHref(product.ingredient_id)} variant="primary" className="mt-3">
            Open The Ingredient
          </TouchLink>
        ) : null}
      </div>
    );
  }

  const facts = factsOf(product);
  return (
    <div className="max-w-2xl lg:pt-6">
      {back}
      <PageHeader title={product.name} subtitle={`${name} · ${category?.name ?? "No category"}`} className="lg:!pt-2" />
      <SaveNote state={save.state} message={save.message} />

      <Group
        title={NEEDS_INGREDIENT}
        footer={`Products are now ingredients. Add this one as an ingredient (or find it if it is already there), switch ${name} on under Ordering on that ingredient, then switch this old one off below. Its past counts and orders are kept.`}
      >
        <div className="px-4 py-3">
          <p className="text-[15px] leading-snug text-label-2">
            {product.ingredient_id ? "The ingredient this product pointed at could not be found." : "This product has no ingredient behind it yet."} Until it has one it keeps working with what was saved on it, shown below. Nothing here can be edited.
          </p>
          <TouchLink href={NEEDS_INGREDIENT_HREF} variant="primary" className="mt-3 w-full sm:w-auto">
            Open Ingredients
          </TouchLink>
        </div>
      </Group>

      <Group title="Saved On This Product">
        <Fact label="Name" value={product.name} />
        <Fact label="Counted By" value={unitTitle(product.unit_name) || "None"} />
        <Fact label="Build To" value={qtyText(product.par)} />
        <Fact label="Supplier" value={supplier?.name ?? "No supplier"} />
        <Fact label="Supplier Item Code" value={facts.code ?? "None"} />
        <Fact label="Price" value={facts.unitInc == null ? "No price" : orderPriceSentence(facts).replace(/^Ordered by the [^:]+: /, "")} />
      </Group>

      <Group>
        <ActiveSwitch checked={product.active} onChange={(v) => void setActive(v)} sub="Off takes it off the count and out of new orders. Past counts keep it. Nothing is deleted." />
      </Group>

      <Group title="History">
        <div className="px-4 py-2">
          <TouchLink href={`${base}/history/products/${product.id}`} className="w-full sm:w-auto">
            Counts And Orders For This Product
          </TouchLink>
        </div>
      </Group>
    </div>
  );
}
