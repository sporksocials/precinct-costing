"use client";

import { useState } from "react";
import { Boxes, LayoutList, Truck } from "lucide-react";
import { Banner, Group, PageHeader, Row } from "@/components/ui";
import { useOrderingVenue } from "@/components/ordering/venue-context";
import { useVenueData } from "@/components/ordering/use-venue-data";
import { CopyVenueSheet } from "@/components/ordering/copy-venue-sheet";
import { TouchBack, TouchButton } from "@/components/ordering/touch";

function Icon({ children }: { children: React.ReactNode }) {
  return <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">{children}</span>;
}

/** Setup home: three visible rows (Suppliers, Categories, Products) for this venue only. */
export default function OrderingSetupHome() {
  const { venue, name, base } = useOrderingVenue();
  const { data, error, reload } = useVenueData(venue.id);
  const [copyOpen, setCopyOpen] = useState(false);
  const active = (n: number | undefined, one: string, many: string) => (n == null ? "" : `${n} ${n === 1 ? one : many}. `);
  return (
    <div className="max-w-2xl lg:pt-6">
      <TouchBack path={base} fallback={base}>
        {name}
      </TouchBack>
      <PageHeader title="Setup" subtitle={`${name} only`} className="lg:!pt-2" />
      {error && !data ? <Banner>{error}</Banner> : null}

      <Group className="mt-3" footer={`Everything here belongs to ${name}. Other venues keep their own suppliers, categories and products.`}>
        <Row href={`${base}/setup/suppliers`} title="Suppliers" sub={`${active(data?.suppliers.filter((s) => s.active).length, "supplier", "suppliers")}Who you order from, how orders go out, minimums.`} wrapSub leading={<Icon><Truck className="h-6 w-6" aria-hidden /></Icon>} chevron className="!min-h-[72px]" />
        <Row href={`${base}/setup/categories`} title="Categories" sub={`${active(data?.categories.length, "category", "categories")}Shelf order, second place and default unit.`} wrapSub leading={<Icon><LayoutList className="h-6 w-6" aria-hidden /></Icon>} chevron className="!min-h-[72px]" />
        <Row href={`${base}/setup/products`} title="Products" sub={`${active(data?.products.filter((p) => p.active).length, "product", "products")}Units, suppliers, prices and Build To levels.`} wrapSub leading={<Icon><Boxes className="h-6 w-6" aria-hidden /></Icon>} chevron className="!min-h-[72px]" />
      </Group>

      <Group title="Starting Point" className="mt-6" footer={`Copies categories, suppliers and active products into ${name} without counts, orders or prices. ${name} is independent afterwards.`}>
        <div className="px-4 py-2">
          <TouchButton className="w-full sm:w-auto" onClick={() => setCopyOpen(true)}>
            Copy Products From Another Venue
          </TouchButton>
        </div>
      </Group>

      <CopyVenueSheet target={venue} open={copyOpen} onClose={() => setCopyOpen(false)} onDone={() => void reload()} />
    </div>
  );
}
