"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { useStore } from "@/lib/store";
import { beerItemId } from "@/lib/beer";
import { costPerBaseFromIndex, resolveTargetGp } from "@/lib/costing";
import { gp, money } from "@/lib/format";
import { parseGpInput, parsePriceInput } from "@/lib/solver";
import { VenueAccent, VENUE_SHORT } from "@/components/venue";
import { KegPicker } from "@/components/beer-parts";
import { PriceHistory } from "@/components/editor/price-history";
import { SetPriceButton } from "@/components/price-actions";
import { ActiveToggle, DeleteRecordSheet, InactiveTag, useRecordImpact } from "@/components/active-parts";
import { TAP_ACTIVE_LABEL, TAP_ACTIVE_SUB } from "@/lib/active";
import { Banner, cx, Empty, FieldRow, Group, InlineInput, Row, useToast } from "@/components/ui";

export default function BeerPage() {
  const { id } = useParams<{ id: string }>();
  const store = useStore();
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const beer = store.beer.beers.find((b) => b.id === id);
  const impact = useRecordImpact("beer", beer?.id);
  if (!beer)
    return (
      <Empty
        title="Beer Not Found"
        body="It may have been removed."
        action={
          <Link href="/menu?cat=Tap%20Beer" className="btn-primary">
            Back to Menu
          </Link>
        }
      />
    );

  const venue = store.venueById.get(beer.venue_id);
  const keg = store.ingredients.find((i) => i.id === beer.ingredient_id);
  const perL = keg ? costPerBaseFromIndex(store.index, keg, store.settings.gst_rate) : 0;
  const defaultTarget = resolveTargetGp({ venue_id: beer.venue_id, category: "Tap Beer", target_override: null }, store.targets);
  const run = (p: Promise<void>) => {
    setError(null);
    p.catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <div className="max-w-2xl lg:pt-6">
      <VenueAccent slug={venue?.slug} />
      <Link href={`/menu?cat=Tap%20Beer${venue ? `&venue=${venue.slug}` : ""}`} className="btn-text -ml-1 !gap-0 !text-accent">
        <ChevronLeft className="h-6 w-6" strokeWidth={2.25} />
        Menu
      </Link>
      <h1 className="mt-2 text-[28px] font-bold leading-tight tracking-tight lg:text-[32px]">{beer.name}</h1>
      <p className="mt-1 text-[15px] text-label-2">
        {venue?.name} · Tap Beer
        {!beer.active ? <InactiveTag /> : null}
      </p>
      {error ? <Banner>{error}</Banner> : null}

      <div className="group-list mt-5">
        <FieldRow label="Name">
          <InlineInput value={beer.name} inputMode="text" width="w-48" onCommit={(t) => t.trim() && t.trim() !== beer.name && run(store.updateBeer(beer.id, { name: t.trim() }))} />
        </FieldRow>
        <Row onClick={() => setPicking(true)} title="Keg" sub={keg ? `${money(Number(keg.pack_price))} per ${Number(keg.pack_size)} L · ${money(perL)}/L incl. yield` : undefined} trailing={<span className="max-w-[12rem] truncate text-label-2">{keg ? keg.name : "Choose"}</span>} chevron />
        {keg ? <Row href={`/ingredients/${keg.id}`} title="Update Keg Price" sub="Changes every serve at once" chevron /> : null}
        <FieldRow label="Target GP" sub={`Blank uses ${VENUE_SHORT[venue?.slug ?? ""] ?? "venue"} Tap Beer: ${gp(defaultTarget, 0)}`}>
          <InlineInput
            value={beer.target_gp != null ? String(Math.round(Number(beer.target_gp) * 1000) / 10) : ""}
            placeholder="Default"
            suffix="%"
            onCommit={(t) => {
              const n = parseGpInput(t);
              if (t.trim() === "") run(store.updateBeer(beer.id, { target_gp: null }));
              else if (n != null) run(store.updateBeer(beer.id, { target_gp: n }));
            }}
          />
        </FieldRow>
        <ActiveToggle
          label={TAP_ACTIVE_LABEL}
          sub={TAP_ACTIVE_SUB}
          record="beer"
          name={beer.name}
          impact={impact}
          undo
          checked={beer.active}
          onChange={(v) => store.updateBeer(beer.id, { active: v })}
          onError={setError}
        />
      </div>

      <Group title="Serves" className="mt-7" footer="Prices include GST. Cost is the serve’s ml of the keg, after the keg’s wastage.">
        {store.beer.serves.map((s) => {
          const c = store.itemCosts.get(beerItemId(beer.id, s.id));
          return (
            <div key={s.id} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px] font-medium sm:text-[15px]">{s.name}</span>
                  <span className="block text-[13px] text-label-2 tnum">
                    {s.ml} ml · cost {c ? money(c.costPerPortion) : "—"}
                  </span>
                </span>
                <InlineInput
                  value={c?.sellInc != null ? Number(c.sellInc).toFixed(2) : ""}
                  placeholder="0.00"
                  prefix="$"
                  onCommit={(t) => run(store.setBeerPrice(beer.id, s.id, { sell_price_inc: parsePriceInput(t) }))}
                />
                <span className={cx("w-16 text-right text-[17px] font-semibold tnum sm:text-[15px]", c?.underTarget ? "text-danger" : "text-label")}>{c?.gpPct != null ? gp(c.gpPct, 1, c.targetGp) : "—"}</span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-[13px] text-label-2">
                  Happy hour
                  <InlineInput
                    value={c?.item.hh_price_inc != null ? Number(c.item.hh_price_inc).toFixed(2) : ""}
                    placeholder="None"
                    prefix="$"
                    width="w-24"
                    onCommit={(t) => run(store.setBeerPrice(beer.id, s.id, { hh_price_inc: parsePriceInput(t) }))}
                  />
                </label>
                {c?.underTarget ? <SetPriceButton c={c} /> : <span className="text-[13px] text-label-3 tnum">target {gp(c?.targetGp ?? defaultTarget, 0)}</span>}
              </div>
            </div>
          );
        })}
      </Group>

      <PriceHistory
        filter={{ kind: "beer_serve", beerId: beer.id, limit: 30 }}
        refreshKey={store.beer.serves.map((s) => { const c = store.itemCosts.get(beerItemId(beer.id, s.id)); return `${c?.sellInc}|${c?.item.hh_price_inc}`; }).join(",")}
        serveNames={Object.fromEntries(store.beer.serves.map((s) => [s.id, s.name]))}
      />

      <div className="mt-8">
        <button className="btn-plain w-full text-danger" onClick={() => setDeleting(true)}>
          Delete Tap Beer…
        </button>
        <p className="px-1 pt-1.5 text-center text-[13px] text-label-2">You see what uses it first. Making it inactive is usually better.</p>
      </div>
      {deleting ? (
        <DeleteRecordSheet
          record="beer"
          name={beer.name}
          impact={{ ...impact, notes: ["Its serve prices go too. The keg stays in Ingredients."] }}
          alreadyInactive={!beer.active}
          onClose={() => setDeleting(false)}
          onMakeInactive={async () => {
            await store.updateBeer(beer.id, { active: false });
            toast.show({ message: `${beer.name} is now inactive`, action: { label: "Undo", onClick: () => run(store.updateBeer(beer.id, { active: true })) } });
          }}
          onDelete={async () => {
            await store.deleteBeer(beer.id);
            setDeleting(false);
            router.push(`/menu?cat=Tap%20Beer${venue ? `&venue=${venue.slug}` : ""}`);
          }}
        />
      ) : null}

      <KegPicker open={picking} onClose={() => setPicking(false)} onPick={(kid) => run(store.updateBeer(beer.id, { ingredient_id: kid }))} initialQuery={beer.name} />
    </div>
  );
}
