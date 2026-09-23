"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { useStore } from "@/lib/store";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { ingredientCostPerBase, priceMovePct } from "@/lib/costing";
import { dateShort, gp, money, movePct, num, packLabel, unitShort } from "@/lib/format";
import { ingredientChangeImpact, type ImpactRow } from "@/lib/insights";
import { addRecent } from "@/lib/recents";
import { PACK_UNITS, type Ingredient, type PriceLog } from "@/lib/types";
import { Banner, cx, Disclosure, Dot, Empty, FieldRow, Group, InlineInput, Row, Segmented, Sheet, Toggle } from "@/components/ui";

export default function IngredientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const store = useStore();
  const ing = store.ingredients.find((i) => i.id === id);
  if (!ing)
    return (
      <Empty
        title="Ingredient not found"
        action={
          <Link className="btn-primary" href="/ingredients">
            Back to ingredients
          </Link>
        }
      />
    );
  return <Detail key={ing.id} ing={ing} />;
}

function Detail({ ing }: { ing: Ingredient }) {
  const store = useStore();
  const [logs, setLogs] = useState<PriceLog[] | null>(null);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gst = store.settings.gst_rate;
  const supplier = store.supplierById.get(ing.supplier_id ?? -1);
  const unitCost = ingredientCostPerBase(ing, gst);

  useEffect(() => {
    addRecent({ kind: "ingredient", id: ing.id, title: ing.name, sub: supplier?.name ?? "Ingredient", href: `/ingredients/${ing.id}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ing.id]);

  // full history for this ingredient (the store only keeps a recent window)
  useEffect(() => {
    let cancelled = false;
    getSupabaseBrowser()
      .from("cost_price_log")
      .select("*")
      .eq("ingredient_id", ing.id)
      .order("changed_at", { ascending: true })
      .then(({ data }) => {
        if (!cancelled) setLogs((data ?? []) as PriceLog[]);
      });
    return () => {
      cancelled = true;
    };
  }, [ing.id, ing.pack_price]);

  const used = useMemo(() => store.usedIn("ingredient", ing.id), [store, ing.id]);
  const history = useMemo(() => (logs ?? []).filter((l) => l.new_price != null), [logs]);
  const series = useMemo(() => {
    const s = history.map((l) => Number(l.new_price));
    if (history[0]?.old_price != null) s.unshift(Number(history[0].old_price));
    return s;
  }, [history]);

  const patch = (p: Partial<Ingredient>) => {
    setError(null);
    store.updateIngredient(ing.id, p).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <div className="lg:pt-6">
      <div className="bar-blur sticky top-0 z-30 -mx-4 flex h-11 items-center px-2 sm:-mx-6 lg:static lg:mx-0 lg:bg-transparent lg:px-0 lg:backdrop-blur-none">
        <Link href="/ingredients" className="btn-text -ml-1 !gap-0">
          <ChevronLeft className="h-6 w-6" strokeWidth={2.25} />
          Ingredients
        </Link>
      </div>
      <h1 className="mt-2 text-[28px] font-bold leading-tight tracking-tight lg:text-[32px]">{ing.name}</h1>
      <p className="mt-1 text-[15px] text-label-2">{[supplier?.name, `${packLabel(ing.pack_size, ing.pack_unit)} pack`, !ing.active ? "Inactive" : null].filter(Boolean).join(" · ")}</p>
      {error ? <Banner>{error}</Banner> : null}

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-8">
        <div>
          <section className="mt-5 rounded-3xl bg-surface p-5">
            <p className="text-[15px] font-medium text-label-2">Pack price</p>
            <p className="display mt-1 text-[64px] tnum text-accent">{money(ing.pack_price)}</p>
            <p className="mt-2 text-[15px] text-label-2 tnum">
              {ing.gst_free ? "GST-free" : ing.price_inc_gst ? "inc GST" : "ex GST"} · {money(unitCost)}/{unitShort(ing.pack_unit)}
              {ing.last_price_update ? ` · updated ${dateShort(ing.last_price_update)}` : ""}
            </p>
            <button type="button" className="btn-primary mt-5 w-full sm:w-auto" onClick={() => setUpdating(true)}>
              Update price
            </button>
          </section>

          <Group title="Price history" className="mt-7">
            {logs === null ? (
              <p className="px-4 py-3 text-[15px] text-label-2">Loading…</p>
            ) : history.length === 0 ? (
              <p className="px-4 py-3 text-[15px] text-label-2">No changes logged yet.</p>
            ) : (
              <>
                {series.length > 1 ? (
                  <div className="px-4 pb-2 pt-4">
                    <PriceLine values={series} />
                  </div>
                ) : null}
                {[...history].reverse().slice(0, 12).map((l) => {
                  const m = priceMovePct(l.old_price, l.new_price);
                  return (
                    <Row
                      key={l.id}
                      title={
                        <span className="tnum">
                          {l.old_price != null ? `${money(l.old_price)} → ` : ""}
                          {money(l.new_price)}
                        </span>
                      }
                      sub={[dateShort(l.changed_at), l.source].filter(Boolean).join(" · ")}
                      trailing={m != null ? <span className={cx(m > 0 ? "text-danger" : "text-label-2")}>{movePct(m)}</span> : null}
                    />
                  );
                })}
              </>
            )}
          </Group>
        </div>

        <div>
          <Group title={`Used in ${used.items.length + used.preps.length}`} className="mt-7 lg:mt-5">
            {used.items.length + used.preps.length === 0 ? <p className="px-4 py-3 text-[15px] text-label-2">Not used in any recipe.</p> : null}
            {used.items
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((it) => {
                const c = store.itemCosts.get(it.id);
                return (
                  <Row
                    key={it.id}
                    href={`/items/${it.id}`}
                    title={it.name}
                    sub={store.venueById.get(it.venue_id)?.name}
                    trailing={
                      c?.gpPct != null ? (
                        <>
                          {c.underTarget ? <Dot className="bg-danger" /> : null}
                          {gp(c.gpPct)}
                        </>
                      ) : null
                    }
                    chevron
                  />
                );
              })}
            {used.preps.map((p) => (
              <Row key={p.id} href={`/preps/${p.id}`} title={p.name} sub="Prep" chevron />
            ))}
          </Group>

          <Disclosure title="Advanced">
            <div className="group-list">
              <FieldRow label="Name">
                <InlineInput value={ing.name} inputMode="text" width="w-48" onCommit={(t) => t.trim() && patch({ name: t.trim() })} />
              </FieldRow>
              <FieldRow label="Supplier">
                <select className="max-w-[12rem] bg-transparent text-right text-[17px] text-label-2 outline-none sm:text-[15px]" value={ing.supplier_id ?? ""} onChange={(e) => patch({ supplier_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">None</option>
                  {store.suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </FieldRow>
              <FieldRow label="Supplier code">
                <InlineInput value={ing.supplier_code ?? ""} placeholder="None" inputMode="text" width="w-36" onCommit={(t) => patch({ supplier_code: t.trim() || null })} />
              </FieldRow>
              <FieldRow label="Pack size">
                <span className="flex items-center gap-2">
                  <InlineInput value={num(ing.pack_size)} width="w-16" onCommit={(t) => Number(t) > 0 && patch({ pack_size: Number(t) })} />
                  <Segmented size="sm" ariaLabel="Pack unit" className="w-[140px]" value={ing.pack_unit} onChange={(u) => patch({ pack_unit: u })} options={PACK_UNITS.map((u) => ({ value: u, label: u }))} />
                </span>
              </FieldRow>
              <FieldRow label="Category">
                <InlineInput value={ing.category ?? ""} placeholder="None" inputMode="text" width="w-40" onCommit={(t) => patch({ category: t.trim() || null })} />
              </FieldRow>
              <FieldRow label="Rebate per pack">
                <InlineInput value={String(ing.rebate ?? 0)} prefix="$" onCommit={(t) => patch({ rebate: Number(t) || 0 })} />
              </FieldRow>
              <FieldRow label="Yield" sub="Usable share after trim, e.g. 85">
                <InlineInput value={String(Math.round((Number(ing.yield_pct) || 1) * 1000) / 10)} suffix="%" onCommit={(t) => { const n = Number(t); if (n > 0) patch({ yield_pct: n > 1 ? n / 100 : n }); }} />
              </FieldRow>
              <Toggle label="Price includes GST" checked={ing.price_inc_gst} onChange={(v) => patch({ price_inc_gst: v })} />
              <Toggle label="GST-free" checked={ing.gst_free} onChange={(v) => patch({ gst_free: v })} />
              <Toggle label="Active" checked={ing.active} onChange={(v) => patch({ active: v })} />
              <div className="px-4 py-2.5">
                <textarea
                  rows={2}
                  defaultValue={ing.notes ?? ""}
                  placeholder="Notes"
                  onBlur={(e) => (e.target.value || null) !== ing.notes && patch({ notes: e.target.value || null })}
                  className="block w-full resize-none bg-transparent text-[17px] outline-none placeholder:text-label-3 sm:text-[15px]"
                />
              </div>
            </div>
          </Disclosure>
        </div>
      </div>

      {updating ? <UpdatePriceSheet ing={ing} onClose={() => setUpdating(false)} /> : null}
    </div>
  );
}

function PriceLine({ values }: { values: number[] }) {
  const w = 320;
  const h = 64;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const pts = values.map((v, i) => [4 + (i / (values.length - 1)) * (w - 8), span ? h - 6 - ((v - min) / span) * (h - 12) : h / 2] as const);
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full text-accent" preserveAspectRatio="none" role="img" aria-label="Price trend">
      <polyline fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" points={pts.map((p) => p.join(",")).join(" ")} />
      <circle cx={last[0]} cy={last[1]} r="3.5" fill="currentColor" />
    </svg>
  );
}

/** Big-number price entry for the invoice-in-hand use case, then shows the GP impact. */
function UpdatePriceSheet({ ing, onClose }: { ing: Ingredient; onClose: () => void }) {
  const store = useStore();
  const [text, setText] = useState("");
  const [incGst, setIncGst] = useState(ing.price_inc_gst);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [impact, setImpact] = useState<ImpactRow[] | null>(null);
  const price = Number(text.replace(/[$,\s]/g, ""));
  const valid = text.trim() !== "" && Number.isFinite(price) && price >= 0;
  const move = valid ? priceMovePct(ing.pack_price, price) : null;

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const p: Partial<Ingredient> = { pack_price: price, source: note.trim() || "Invoice" };
    if (incGst !== ing.price_inc_gst) p.price_inc_gst = incGst;
    const rows = ingredientChangeImpact(ing.id, p, store);
    try {
      await store.updateIngredient(ing.id, p);
      setImpact(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (impact) {
    const venuesOf = (r: ImpactRow) => store.venueById.get(r.item.venue_id)?.name;
    return (
      <Sheet open onClose={onClose} title="Price updated" cancelLabel={null} action={{ label: "Done", onClick: onClose }}>
        <div className="pb-2 pt-4">
          <p className="text-center text-[15px] text-label-2">{ing.name}</p>
          <p className="text-center text-[34px] font-semibold tnum">{money(price)}</p>
          {impact.length === 0 ? (
            <p className="py-6 text-center text-[15px] text-label-2">Not used in any recipe — nothing else changes.</p>
          ) : (
            <Group title={`Used in ${impact.length} ${impact.length === 1 ? "recipe" : "recipes"}`} className="mt-4">
              {impact.map((r) => {
                const worse = (r.after.gpPct ?? 0) < (r.before.gpPct ?? 0) - 1e-9;
                return (
                  <Row
                    key={r.item.id}
                    href={`/items/${r.item.id}`}
                    onClick={onClose}
                    title={r.item.name}
                    sub={venuesOf(r)}
                    trailing={
                      r.before.gpPct == null ? (
                        <span className="text-label-3">No price</span>
                      ) : (
                        <span className="tnum">
                          <span className="text-label-2">GP {gp(r.before.gpPct, 0)} → </span>
                          <span className={cx("font-semibold", r.after.underTarget ? "text-danger" : worse ? "text-label" : "text-label")}>{gp(r.after.gpPct, 0)}</span>
                        </span>
                      )
                    }
                  />
                );
              })}
            </Group>
          )}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={onClose} title="Update price" action={{ label: busy ? "Saving…" : "Save", onClick: () => void save(), disabled: !valid || busy }}>
      <form
        className="pb-2 pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error ? <Banner>{error}</Banner> : null}
        <p className="text-center text-[15px] text-label-2">
          {ing.name} · {packLabel(ing.pack_size, ing.pack_unit)} pack
        </p>
        <label className="mt-3 flex items-center justify-center gap-1 rounded-2xl bg-surface px-4 py-5">
          <span className="text-[34px] font-semibold text-label-3">$</span>
          <input
            autoFocus
            inputMode="decimal"
            enterKeyHint="done"
            aria-label="New pack price"
            placeholder={Number(ing.pack_price).toFixed(2)}
            value={text}
            onChange={(e) => setText(e.target.value)}
            style={{ width: `${Math.max(text.length || Number(ing.pack_price).toFixed(2).length, 3) + 0.3}ch` }}
            className="min-w-0 max-w-[9ch] bg-transparent text-[48px] font-semibold leading-none tnum outline-none placeholder:text-label-3"
          />
        </label>
        <p className="mt-2 h-5 text-center text-[13px] text-label-2 tnum">
          {move != null && Math.abs(move) > 1e-9 ? (
            <>
              Was {money(ing.pack_price)} · <span className={move > 0 ? "text-danger" : ""}>{movePct(move, 1)}</span>
            </>
          ) : (
            `Currently ${money(ing.pack_price)}`
          )}
        </p>
        <div className="group-list mt-4">
          <Toggle checked={incGst} onChange={setIncGst} label="Price includes GST" />
          <div className="px-4">
            <input className="h-11 w-full bg-transparent text-[17px] outline-none placeholder:text-label-3 sm:text-[15px]" placeholder="Invoice / note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <button type="submit" className="btn-primary mt-5 w-full" disabled={!valid || busy}>
          {busy ? "Saving…" : "Save price"}
        </button>
      </form>
    </Sheet>
  );
}
