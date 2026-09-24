"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Plus, SlidersHorizontal } from "lucide-react";
import { useStore } from "@/lib/store";
import { resolveTargetGp, type ItemCost } from "@/lib/costing";
import { FLAVOUR_PREP_TYPE, flavourName, virtualItemId } from "@/lib/gelato";
import { gp, money } from "@/lib/format";
import type { GelatoServe, Prep } from "@/lib/types";
import { AddButton, Banner, cx, Dot, Empty, Group, PageHeader, Row, Segmented, Sheet } from "@/components/ui";

type View = "menu" | "all";

export default function GelatoPage() {
  const store = useStore();
  const g = store.gelato;
  const [view, setView] = useState<View>("menu");
  const [showInactive, setShowInactive] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const venue = g.venue;
  const target = venue ? resolveTargetGp({ venue_id: venue.id, category: "Gelato", target_override: null }, store.targets) : 0.72;
  const onMenu = g.serves.filter((s) => s.on_menu);
  const serves = view === "menu" && onMenu.length ? onMenu : g.serves;
  const flavours = showInactive ? g.flavours : g.flavours.filter((f) => f.active);
  const inactiveCount = g.flavours.length - g.flavours.filter((f) => f.active).length;

  const cell = (f: Prep, s: GelatoServe): ItemCost | undefined => store.itemCosts.get(virtualItemId(f.id, s.id));

  const serveStats = useMemo(
    () =>
      serves.map((s) => {
        const cs = flavours.filter((f) => f.active).map((f) => ({ f, c: cell(f, s) })).filter((x): x is { f: Prep; c: ItemCost } => !!x.c);
        const costs = cs.map((x) => x.c.costPerPortion);
        const worst = cs.reduce<{ f: Prep; c: ItemCost } | null>((w, x) => (x.c.gpPct != null && (w == null || (w.c.gpPct ?? 9) > x.c.gpPct) ? x : w), null);
        const dearest = cs.reduce<{ f: Prep; c: ItemCost } | null>((d, x) => (d == null || x.c.costPerPortion > d.c.costPerPortion ? x : d), null);
        return {
          s,
          min: costs.length ? Math.min(...costs) : 0,
          max: costs.length ? Math.max(...costs) : 0,
          worst,
          dearest,
          under: cs.filter((x) => x.c.underTarget).length,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serves, flavours, store.itemCosts],
  );

  if (!venue) return <Empty title="Gelato Rumba Isn’t Set Up" body="There’s no Gelato Rumba venue in the system." />;

  return (
    <div className="v-gelato">
      <PageHeader
        title="Gelato"
        subtitle={`${g.flavours.filter((f) => f.active).length} flavours · ${g.serves.length} serves · target ${gp(target, 0)} · ${gp(store.settings.gelato_wastage, 0)} wastage`}
        trailing={
          <>
            <Link href="/gelato/serves" className="btn-plain hidden lg:inline-flex">
              <SlidersHorizontal className="h-4 w-4" strokeWidth={2.25} /> Serves
            </Link>
            <AddButton label="New Flavour" onClick={() => setNewOpen(true)} />
          </>
        }
      />
      <p className="max-w-2xl px-1 text-[15px] text-label-2">
        Add a flavour’s mix and every serve is priced for you.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <Segmented
          ariaLabel="Serves shown"
          className="w-full lg:w-80"
          value={view}
          onChange={setView}
          options={[
            { value: "menu", label: `On the Menu (${onMenu.length})` },
            { value: "all", label: `All Serves (${g.serves.length})` },
          ]}
        />
      </div>

      {/* serves */}
      <Group
        title="Serves"
        className="mt-5"
        trailing={
          <Link href="/gelato/serves" className="text-[13px] font-medium text-accent lg:hidden">
            Edit Serves
          </Link>
        }
        footer={`Same price for every flavour. Suggested price covers the dearest flavour at the serve’s target (${gp(target, 0)} unless set on the serve).`}
      >
        {serveStats.map(({ s, min, max, worst, dearest, under }) => {
          const price = s.sell_price_inc != null ? Number(s.sell_price_inc) : null;
          const sugg = dearest?.c.suggestedInc ?? 0;
          return (
            <Row
              key={s.id}
              href="/gelato/serves"
              title={
                <>
                  {s.name}
                  {!s.on_menu ? <span className="ml-1.5 text-[13px] text-label-3">not on menu</span> : null}
                </>
              }
              sub={[`${Number(s.grams)}g`, min === max ? `cost ${money(min)}` : `cost ${money(min)}–${money(max)}`, s.target_gp != null ? `target ${gp(Number(s.target_gp), 0)}` : null, sugg ? `suggested ${money(sugg)}` : null, under ? `${under} under target` : null].filter(Boolean).join(" · ")}
              trailing={
                <>
                  <span className="text-label">{price != null ? money(price) : "No price"}</span>
                  {worst?.c.gpPct != null ? (
                    <span className={cx("ml-2 inline-flex items-center gap-1", worst.c.underTarget ? "text-danger" : "text-label-2")}>
                      {worst.c.underTarget ? <Dot className="bg-danger" /> : null}
                      {gp(worst.c.gpPct)}
                    </span>
                  ) : null}
                </>
              }
            />
          );
        })}
      </Group>

      {/* flavour x serve grid */}
      <section className="mt-7">
        <div className="flex items-end justify-between px-4 pb-1.5">
          <h2 className="text-[13px] font-medium text-label-2">GP by flavour</h2>
          {inactiveCount ? (
            <button type="button" className="text-[13px] font-medium text-accent" onClick={() => setShowInactive((x) => !x)}>
              {showInactive ? "Hide inactive" : `Show inactive (${inactiveCount})`}
            </button>
          ) : null}
        </div>
        {flavours.length === 0 ? (
          <Empty
            title="No Flavours Yet"
            body="Add a flavour and write its mix — the serve prices follow."
            action={
              <button className="btn-primary" onClick={() => setNewOpen(true)}>
                <Plus className="h-4 w-4" strokeWidth={2.5} /> New Flavour
              </button>
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-[10px] bg-surface">
            <table className="w-full border-collapse text-[15px] tnum sm:text-[13px]">
              <thead>
                <tr className="text-left text-label-2">
                  <th className="sticky left-0 z-10 min-w-[160px] bg-surface px-4 py-2 font-medium">Flavour</th>
                  <th className="whitespace-nowrap px-2 py-2 text-right font-medium">Mix /kg</th>
                  {serves.map((s) => (
                    <th key={s.id} className="whitespace-nowrap px-2 py-2 text-right font-medium">
                      {s.name}
                      <span className="block text-[11px] font-normal text-label-3">{s.sell_price_inc != null ? money(Number(s.sell_price_inc)) : "—"}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {flavours.map((f) => {
                  const pc = store.prepCosts.get(f.id);
                  return (
                    <tr key={f.id} className="border-t-[0.5px] border-sep">
                      <td className="sticky left-0 z-10 bg-surface px-4 py-2">
                        <Link href={`/preps/${f.id}`} className={cx("block max-w-[220px] truncate hover:underline", f.active ? "text-label" : "text-label-3")}>
                          {flavourName(f)}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right text-label-2">{pc ? money(pc.costPerUnit) : "—"}</td>
                      {serves.map((s) => {
                        const c = cell(f, s);
                        return (
                          <td key={s.id} title={c ? `Cost ${money(c.costPerPortion)}` : undefined} className={cx("whitespace-nowrap px-2 py-2 text-right", c?.underTarget ? "font-semibold text-danger" : "text-label")}>
                            {c?.gpPct != null ? gp(c.gpPct) : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="px-4 pt-1.5 text-[13px] text-label-2">Red is under target. Tap a flavour to edit its mix.</p>
      </section>

      <div className="mt-6 lg:hidden">
        <div className="group-list">
          <Row href="/gelato/serves" leading={<SlidersHorizontal className="h-5 w-5 text-label-2" strokeWidth={2} />} title="Serves, Prices & Packaging" sub="Grams, price, cups/cones and wastage" chevron />
        </div>
      </div>


      {newOpen ? <NewFlavourSheet venueId={venue.id} onClose={() => setNewOpen(false)} /> : null}
    </div>
  );
}

function NewFlavourSheet({ venueId, onClose }: { venueId: number; onClose: () => void }) {
  const store = useStore();
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = name.trim().replace(/\s+gelato\s+mix$/i, "").trim();
  const exists = !!clean && store.gelato.flavours.some((f) => flavourName(f).toLowerCase() === clean.toLowerCase());

  async function create() {
    if (!clean || exists || busy) return;
    setBusy(true);
    setError(null);
    try {
      const id = await store.insertPrep({ name: `${clean} gelato mix`, venue_id: venueId, prep_type: FLAVOUR_PREP_TYPE, yield_qty: 1, yield_unit: "kg", active: true, source: "app", notes: null });
      onClose();
      router.push(`/preps/${id}?new=1`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title="New Flavour" action={{ label: busy ? "Adding…" : "Add", onClick: () => void create(), disabled: !clean || exists || busy }}>
      <form
        className="space-y-4 pb-2 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        {error ? <Banner>{error}</Banner> : null}
        <input autoFocus className="field !text-[20px] font-semibold" placeholder="Flavour name, e.g. Lemon Sorbet" value={name} onChange={(e) => setName(e.target.value)} aria-label="Flavour Name" />
        {exists ? <p className="px-1 text-[13px] text-danger">There’s already a {clean} flavour.</p> : null}
        <p className="px-1 text-[13px] text-label-2">Next you’ll add the mix ingredients (base, paste, toppings). Every serve is priced from the mix automatically — no recipes to set up.</p>
        <button type="submit" className="btn-primary w-full" disabled={!clean || exists || busy}>
          {busy ? "Adding…" : "Add Flavour"}
        </button>
      </form>
    </Sheet>
  );
}
