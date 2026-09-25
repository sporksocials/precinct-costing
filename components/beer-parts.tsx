"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { ingredientCostPerBase } from "@/lib/costing";
import { money } from "@/lib/format";
import { indexDoc, search } from "@/lib/search";
import { parsePriceInput } from "@/lib/solver";
import { VENUE_SHORT } from "./venue";
import { Banner, Chips, FieldRow, InlineInput, Group, Row, SearchField, Sheet } from "./ui";

/** Pick the keg a beer pours from: ingredients priced per litre, best matches first. */
export function KegPicker({ open, onClose, onPick, initialQuery = "" }: { open: boolean; onClose: () => void; onPick: (ingredientId: string) => void; initialQuery?: string }) {
  const store = useStore();
  const [q, setQ] = useState(initialQuery);
  const docs = useMemo(
    () =>
      store.ingredients
        .filter((i) => i.active && i.pack_unit === "L")
        .map((i) => ({ ...indexDoc({ kind: "ingredient" as const, id: i.id, title: i.name, sub: "", href: "", extra: store.supplierById.get(i.supplier_id ?? -1)?.name ?? "" }), i })),
    [store.ingredients, store.supplierById],
  );
  const rows = useMemo(() => {
    const list = q.trim() ? search(docs, q, 60).map((h) => h.doc) : docs.filter((d) => /keg/i.test(d.i.name)).sort((a, b) => a.i.name.localeCompare(b.i.name));
    return list.slice(0, 60);
  }, [docs, q]);
  return (
    <Sheet open={open} onClose={onClose} title="Choose Keg" cancelLabel="Cancel">
      <div className="pb-2 pt-3">
        <SearchField value={q} onChange={setQ} placeholder="Search kegs" autoFocus />
        <div className="group-list mt-3">
          {rows.map(({ i }) => (
            <Row
              key={i.id}
              onClick={() => {
                onPick(i.id);
                onClose();
              }}
              title={i.name}
              sub={[store.supplierById.get(i.supplier_id ?? -1)?.name, `${Number(i.pack_size)} L`].filter(Boolean).join(" · ")}
              trailing={<span className="text-label-2">{money(ingredientCostPerBase(i, store.settings.gst_rate))}/L</span>}
            />
          ))}
          {rows.length === 0 ? <p className="px-4 py-3 text-[15px] text-label-2">No keg matches. Add the keg as an ingredient priced per litre first.</p> : null}
        </div>
      </div>
    </Sheet>
  );
}

/** New tap beer: name, venue, keg and the serve prices. Opens the beer's own page when added. */
export function NewBeerSheet({ defaultVenueId, onClose }: { defaultVenueId: number | undefined; onClose: () => void }) {
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

/** The serve sizes (ml), shared by every tap beer at every venue. Opened from the Tap Beer view of the Menu. */
export function BeerServeSizesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useStore();
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet open={open} onClose={onClose} title="Serve Sizes" cancelLabel="Done">
      <div className="pb-2 pt-3">
        {error ? <Banner>{error}</Banner> : null}
        <Group footer="The same sizes for every tap beer at every venue. Wastage is set on each keg (its yield).">
          {store.beer.serves.map((s) => (
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
      </div>
    </Sheet>
  );
}
