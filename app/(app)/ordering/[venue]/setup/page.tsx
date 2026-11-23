"use client";

import { Boxes, LayoutList, Truck } from "lucide-react";
import { Banner, Group, PageHeader, Row } from "@/components/ui";
import { useOrderingVenue } from "@/components/ordering/venue-context";
import { useVenueData } from "@/components/ordering/use-venue-data";
import { TouchBack } from "@/components/ordering/touch";

function Icon({ children }: { children: React.ReactNode }) {
  return <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">{children}</span>;
}

/** Setup home: three visible rows (Suppliers, Categories, Products) for this venue only. */
export default function OrderingSetupHome() {
  const { venue, name, base } = useOrderingVenue();
  const { data, error } = useVenueData(venue.id);
  const active = (n: number | undefined, one: string, many: string) => (n == null ? "" : `${n} ${n === 1 ? one : many}. `);
  return (
    <div className="max-w-2xl lg:pt-6">
      <TouchBack path={base} fallback={base}>
        {name}
      </TouchBack>
      <PageHeader title="Setup" subtitle={`${name} only`} className="lg:!pt-2" />
      {error && !data ? <Banner>{error}</Banner> : null}

      <Group className="mt-3" footer={`This is ${name}'s own order list and terms. What a product IS (its name, supplier, item code and price) lives on its ingredient and is the same at every venue.`}>
        <Row href={`${base}/setup/suppliers`} title="Suppliers" sub={`${active(data?.suppliers.filter((s) => s.active).length, "supplier", "suppliers")}Who you order from, how orders go out, minimums.`} wrapSub leading={<Icon><Truck className="h-6 w-6" aria-hidden /></Icon>} chevron className="!min-h-[72px]" />
        <Row href={`${base}/setup/categories`} title="Categories" sub={`${active(data?.categories.length, "category", "categories")}Shelf order, second place and default unit.`} wrapSub leading={<Icon><LayoutList className="h-6 w-6" aria-hidden /></Icon>} chevron className="!min-h-[72px]" />
        <Row href={`${base}/setup/products`} title="Products" sub={`${active(data?.products.filter((p) => p.active).length, "product", "products")}The order list in shelf order. A product is added and changed on its ingredient.`} wrapSub leading={<Icon><Boxes className="h-6 w-6" aria-hidden /></Icon>} chevron className="!min-h-[72px]" />
      </Group>

    </div>
  );
}
