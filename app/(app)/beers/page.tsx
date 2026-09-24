"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { beerItemId } from "@/lib/beer";
import { ingredientCostPerBase, type ItemCost } from "@/lib/costing";
import { gp, money } from "@/lib/format";
import { parsePriceInput } from "@/lib/solver";
import { useVenue, VenueFilter, VENUE_SHORT } from "@/components/venue";
import { RecipeTabs } from "@/components/recipe-tabs";
import { KegPicker } from "@/components/beer-parts";
import { AddButton, Banner, Chips, cx, Dot, Empty, FieldRow, Group, InlineInput, PageHeader, Row, Sheet } from "@/components/ui";

export default function BeersPage() {
  const store = useStore();
  const { venue } = useVenue();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const serves = store.beer.serves;

  const beers = useMemo(() => store.beer.beers.filter((b) => (!venue || b.venue_id === venue.id)), [store.beer.beers, venue]);
  const worstOf = (beerId: string): ItemCost | null =>
    serves
      .map((s) => store.itemCosts.get(beerItemId(beerId, s.id)))
      .filter((c): c is ItemCost => !!c && c.gpPct != null)
      .reduce<ItemCost | null>((w, c) => (w == null || (c.gpPct ?? 9) < (w.gpPct ?? 9) ? c : w), null);

  return (
    <div className="max-w-3xl">
      <PageHeader title="Recipes" trailing={<AddButton label="New Tap Beer" onClick={() => setAdding(true)} />} />
      <VenueFilter className="mb-3" />
      <RecipeTabs current="beers" className="lg:w-80" />
      {error ? <Banner>{error}</Banner> : null}
      <p className="mt-4 px-1 text-[15px] text-label-2">Every beer is one keg poured in the same serves. Add a beer, pick its keg and type its prices — the cost and GP of every serve follow the keg price.</p>

      {beers.length === 0 ? (
        <Empty title="No Tap Beers" body={venue ? `Nothing on tap at ${venue.name} yet.` : "Add the first tap beer."} action={<button className="btn-primary" onClick={() => setAdding(true)}>New Tap Beer</button>} />
      ) : (
        <Group title={`On Tap · ${beers.length}`} className="mt-5">
          {beers.map((b) => {
            const keg = store.ingredients.find((i) => i.id === b.ingredient_id);
            const w = worstOf(b.id);
            const v = store.venueById.get(b.venue_id);
            const prices = serves.map((s) => store.itemCosts.get(beerItemId(b.id, s.id))?.sellInc).map((p) => (p != null ? money(p) : "—"));
            return (
              <Row
                key={b.id}
                href={`/beers/${b.id}`}
                title={<span className={cx(!b.active && "text-label-2")}>{b.name}</span>}
                sub={[venue ? null : VENUE_SHORT[v?.slug ?? ""], prices.join(" · "), keg ? `keg ${money(ingredientCostPerBase(keg, store.settings.gst_rate))}/L` : "no keg"].filter(Boolean).join(" · ")}
                trailing={
                  w ? (
                    <span className={cx("flex items-center gap-1.5 font-semibold", w.underTarget ? "text-danger" : "text-label")}>
                      {w.underTarget ? <Dot className="bg-danger" /> : null}
                      {gp(w.gpPct)}
                    </span>
                  ) : null
                }
                chevron
              />
            );
          })}
        </Group>
      )}
      <p className="px-4 pt-1.5 text-[13px] text-label-2">GP shown is the lowest of the serves.</p>

      <Group title="Serve Sizes" className="mt-8" footer="The same sizes for every tap beer at every venue. Wastage is set on each keg (its yield), as before.">
        {serves.map((s) => (
          <FieldRow key={s.id} label={s.name}>
            <InlineInput
              value={String(s.ml)}
              suffix="ml"
              onCommit={(t) => {
                const n = Number(t.replace(/[^\d.]/g, ""));
                if (n > 0) store.updateBeerServe(s.id, { ml: n }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
              }}
            />
          </FieldRow>
        ))}
      </Group>

      {adding ? <NewBeerSheet defaultVenueId={(venue && venue.slug !== "gelato" ? venue.id : undefined) ?? store.venues.find((v) => v.slug === "drift")?.id ?? store.venues[0]?.id} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

function NewBeerSheet({ defaultVenueId, onClose }: { defaultVenueId: number | undefined; onClose: () => void }) {
  const store = useStore();
  const router = useRouter();
  const serves = store.beer.serves;
  const [name, setName] = useState("");
  const [venueId, setVenueId] = useState<number | undefined>(defaultVenueId);
  const [kegId, setKegId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keg = store.ingredients.find((i) => i.id === kegId);
  const exists = !!name.trim() && store.beer.beers.some((b) => b.venue_id === venueId && b.name.toLowerCase() === name.trim().toLowerCase());
  const can = !!name.trim() && venueId != null && !!kegId && !exists && !busy;

  async function create() {
    if (!can || venueId == null) return;
    setBusy(true);
    setError(null);
    try {
      const id = await store.insertBeer(
        { venue_id: venueId, name: name.trim(), ingredient_id: kegId, target_gp: null, active: true, sort: 0, notes: null },
        serves.map((s) => ({ serve_id: s.id, sell_price_inc: parsePriceInput(prices[s.id] ?? "") })),
      );
      onClose();
      router.push(`/beers/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title="New Tap Beer" action={{ label: busy ? "Adding…" : "Add", onClick: () => void create(), disabled: !can }}>
      <div className="space-y-5 pb-2 pt-3">
        {error ? <Banner>{error}</Banner> : null}
        <input autoFocus className="field !text-[20px] font-semibold" placeholder="Beer name, e.g. Stone & Wood Pacific" value={name} onChange={(e) => setName(e.target.value)} aria-label="Beer name" />
        {exists ? <p className="px-1 text-[13px] text-danger">That venue already has a beer with this name.</p> : null}
        <div>
          <p className="section-label !px-1">Venue</p>
          <Chips
            ariaLabel="Venue"
            value={venueId != null ? String(venueId) : ""}
            onChange={(v) => setVenueId(Number(v))}
            options={store.venues.filter((v) => v.slug !== "gelato").map((v) => ({ value: String(v.id), label: VENUE_SHORT[v.slug] ?? v.name, className: venueId === v.id ? `v-${v.slug}` : undefined }))}
            className="[&>button:not([aria-checked=true])]:bg-fill"
          />
        </div>
        <div className="group-list">
          <Row
            onClick={() => setPicking(true)}
            title="Keg"
            trailing={<span className={keg ? "text-label-2" : "text-accent"}>{keg ? keg.name : "Choose"}</span>}
            chevron
          />
          {serves.map((s) => (
            <FieldRow key={s.id} label={s.name} sub={`${s.ml} ml`}>
              <InlineInput value={prices[s.id] ?? ""} placeholder="0.00" prefix="$" onCommit={(t) => setPrices((p) => ({ ...p, [s.id]: t }))} />
            </FieldRow>
          ))}
        </div>
        <p className="px-1 text-[13px] text-label-2">Prices include GST. Leave one blank if that serve isn’t sold; you can change them any time.</p>
        <button type="button" className="btn-primary w-full" disabled={!can} onClick={() => void create()}>
          {busy ? "Adding…" : "Add Tap Beer"}
        </button>
      </div>
      <KegPicker open={picking} onClose={() => setPicking(false)} onPick={setKegId} initialQuery={name} />
    </Sheet>
  );
}
