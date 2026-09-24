"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { useStore } from "@/lib/store";
import { beerItemId } from "@/lib/beer";
import { ingredientCostPerBase, resolveTargetGp } from "@/lib/costing";
import { gp, money } from "@/lib/format";
import { parsePriceInput } from "@/lib/solver";
import { VENUE_SHORT } from "@/components/venue";
import { KegPicker } from "@/components/beer-parts";
import { PriceHistory } from "@/components/editor/price-history";
import { SetPriceButton } from "@/components/price-actions";
import { Banner, cx, Empty, FieldRow, Group, InlineInput, Row, Toggle } from "@/components/ui";

export default function BeerPage() {
  const { id } = useParams<{ id: string }>();
  const store = useStore();
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const beer = store.beer.beers.find((b) => b.id === id);
  if (!beer)
    return (
      <Empty
        title="Beer Not Found"
        body="It may have been removed."
        action={
          <Link href="/beers" className="btn-primary">
            Back to Tap Beers
          </Link>
        }
      />
    );

  const venue = store.venueById.get(beer.venue_id);
  const keg = store.ingredients.find((i) => i.id === beer.ingredient_id);
  const perL = keg ? ingredientCostPerBase(keg, store.settings.gst_rate) : 0;
  const defaultTarget = resolveTargetGp({ venue_id: beer.venue_id, category: "Tap Beer", target_override: null }, store.targets);
  const run = (p: Promise<void>) => {
    setError(null);
    p.catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <div className={cx(venue ? `v-${venue.slug}` : "", "max-w-2xl lg:pt-6")}>
      <Link href="/beers" className="btn-text -ml-1 !gap-0 !text-accent">
        <ChevronLeft className="h-6 w-6" strokeWidth={2.25} />
        Tap Beers
      </Link>
      <h1 className="mt-2 text-[28px] font-bold leading-tight tracking-tight lg:text-[32px]">{beer.name}</h1>
      <p className="mt-1 text-[15px] text-label-2">
        {venue?.name} · Tap Beer{!beer.active ? " · Off" : ""}
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
              const n = Number(t.replace(/[%\s]/g, ""));
              run(store.updateBeer(beer.id, { target_gp: t.trim() === "" || !Number.isFinite(n) ? null : n >= 1 ? n / 100 : n }));
            }}
          />
        </FieldRow>
        <Toggle label="On Tap" sub="Off hides it from averages and alerts" checked={beer.active} onChange={(v) => run(store.updateBeer(beer.id, { active: v }))} />
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
                <span className={cx("w-16 text-right text-[17px] font-semibold tnum sm:text-[15px]", c?.underTarget ? "text-danger" : "text-label")}>{c?.gpPct != null ? gp(c.gpPct) : "—"}</span>
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
        {confirmDelete ? (
          <div className="space-y-2">
            <p className="px-1 text-center text-[15px] text-label-2">Delete {beer.name}? Its prices go too. The keg stays in Ingredients.</p>
            <button
              className="btn w-full bg-danger-soft text-danger"
              onClick={() =>
                store
                  .deleteBeer(beer.id)
                  .then(() => router.push("/beers"))
                  .catch((e) => setError(e instanceof Error ? e.message : String(e)))
              }
            >
              Delete Tap Beer
            </button>
            <button className="btn-plain w-full" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="btn-plain w-full text-danger" onClick={() => setConfirmDelete(true)}>
            Delete Tap Beer…
          </button>
        )}
      </div>

      <KegPicker open={picking} onClose={() => setPicking(false)} onPick={(kid) => run(store.updateBeer(beer.id, { ingredient_id: kid }))} initialQuery={beer.name} />
    </div>
  );
}
