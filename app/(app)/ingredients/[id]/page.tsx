"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ReviewSheet } from "@/components/price-review";
import { DealPriceBlock, DealsSection } from "@/components/deal-editor";
import { ChevronLeft } from "lucide-react";
import { useStore } from "@/lib/store";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { ingredientCostPerBase, priceMovePct } from "@/lib/costing";
import { withEffectivePrice } from "@/lib/deals";
import { dateShort, gp, money, movePct, num, packLabel, unitShort } from "@/lib/format";
import { ingredientChangeImpact, type ImpactRow } from "@/lib/insights";
import { reviewChangesFromImpact, type ReviewChange } from "@/lib/price-review";
import { parsePercentInput } from "@/lib/solver";
import { addRecent } from "@/lib/recents";
import { PACK_UNITS, type Ingredient, type PriceLog } from "@/lib/types";
import { Banner, cx, Disclosure, Dot, Empty, FieldRow, Group, InlineInput, Row, Segmented, Sheet, Toggle } from "@/components/ui";

/** entered_by marker for alternate prices carried over from the source sheets. */
const ALT_PRICE_TAG = "Source sheet (other price)";

export default function IngredientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const store = useStore();
  const ing = store.ingredients.find((i) => i.id === id);
  if (!ing)
    return (
      <Empty
        title="Ingredient Not Found"
        action={
          <Link className="btn-primary" href="/ingredients">
            Back to Ingredients
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
  const [pending, setPending] = useState<PendingEdit | null>(null);
  const [review, setReview] = useState<ReviewChange[] | null>(null);
  const [addingDeal, setAddingDeal] = useState(false);
  const gst = store.settings.gst_rate;
  const supplier = store.supplierById.get(ing.supplier_id ?? -1);

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
  // "Other prices" are alternate prices found for this ingredient in the original costing sheets or supplier
  // portals. They're kept for reference (to pick the right one), not charted as price changes.
  const isAlt = (l: PriceLog) => l.entered_by === ALT_PRICE_TAG;
  const history = useMemo(() => (logs ?? []).filter((l) => l.new_price != null && !isAlt(l)), [logs]);
  const alternates = useMemo(() => (logs ?? []).filter(isAlt), [logs]);
  const series = useMemo(() => {
    const s = history.map((l) => Number(l.new_price));
    if (history[0]?.old_price != null) s.unshift(Number(history[0].old_price));
    return s;
  }, [history]);

  const save = (p: Partial<Ingredient>) => {
    setError(null);
    store.updateIngredient(ing.id, p).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  // Edits that change what a unit costs (pack size or unit, yield, rebate, GST) show their impact on
  // dishes first when it matters: unit cost moves by more than 5%, a dish falls below target, or the
  // pack unit changes. Anything smaller applies straight away. Nothing else is touched.
  const patch = (p: Partial<Ingredient>) => {
    if (COST_KEYS.some((k) => k in p)) {
      const next = { ...ing, ...p };
      const before = ingredientCostPerBase(withEffectivePrice(ing, store.deals), gst);
      const after = ingredientCostPerBase(withEffectivePrice(next, store.deals), gst);
      const change = before > 0 ? (after - before) / before : after > 0 ? 1 : 0;
      const rows = ingredientChangeImpact(ing.id, p, { ...store, lines: store.allLines });
      const unitChanged = p.pack_unit !== undefined && p.pack_unit !== ing.pack_unit;
      const newlyUnder = rows.some((r) => r.after.underTarget && !r.before.underTarget);
      if (rows.length && (Math.abs(change) > 0.05 || newlyUnder || unitChanged)) {
        setPending({ patch: p, rows, before, after, change, unitChanged });
        return;
      }
    }
    save(p);
  };
  const confirmPending = async () => {
    if (!pending) return;
    const { patch: p, rows } = pending;
    setError(null);
    try {
      await store.updateIngredient(ing.id, p);
      const changes = reviewChangesFromImpact(rows.filter((r) => r.after.underTarget), store.itemCosts.values(), gst);
      setPending(null);
      if (changes.length) setReview(changes);
    } catch (e) {
      setPending(null);
      setError(e instanceof Error ? e.message : String(e));
    }
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
            <DealPriceBlock ing={ing} updatedText={ing.last_price_update ? ` · updated ${dateShort(ing.last_price_update)}` : ""} />
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button type="button" className="btn-primary w-full sm:w-auto" onClick={() => setUpdating(true)}>
                Update Price
              </button>
              <button type="button" className="btn-tinted w-full sm:w-auto" onClick={() => setAddingDeal(true)}>
                Add Deal
              </button>
            </div>
          </section>

          <DealsSection ing={ing} adding={addingDeal} onAddingChange={setAddingDeal} renderImpact={(rows) => <ImpactPreview rows={rows} />} />

          <Group title="Price History" className="mt-7">
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
          {alternates.length ? (
            <Group title="Other Prices Found in the Original Sheets" className="mt-7 lg:mt-5" footer="Check these against a current invoice. Update the price above if one of them is right.">
              {alternates.map((l) => (
                <Row key={l.id} title={<span className="tnum">{money(l.new_price)}{l.notes ? <span className="text-label-2"> · {l.notes}</span> : null}</span>} sub={l.source ?? undefined} />
              ))}
            </Group>
          ) : null}
          <Group title={`Used In ${used.items.length + used.preps.length}`} className="mt-7 lg:mt-5">
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

          <Disclosure title="Advanced" hint="Name, pack, GST, yield, supplier code">
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
              <FieldRow label="Supplier Code">
                <InlineInput value={ing.supplier_code ?? ""} placeholder="None" inputMode="text" width="w-36" onCommit={(t) => patch({ supplier_code: t.trim() || null })} />
              </FieldRow>
              <FieldRow label="Pack Size">
                <span className="flex items-center gap-2">
                  <InlineInput value={num(ing.pack_size)} width="w-16" onCommit={(t) => Number(t) > 0 && patch({ pack_size: Number(t) })} />
                  <Segmented size="sm" ariaLabel="Pack unit" className="w-[140px]" value={ing.pack_unit} onChange={(u) => patch({ pack_unit: u })} options={PACK_UNITS.map((u) => ({ value: u, label: u }))} />
                </span>
              </FieldRow>
              <FieldRow label="Category">
                <InlineInput value={ing.category ?? ""} placeholder="None" inputMode="text" width="w-40" onCommit={(t) => patch({ category: t.trim() || null })} />
              </FieldRow>
              <FieldRow label="Rebate per Pack">
                <InlineInput value={String(ing.rebate ?? 0)} prefix="$" onCommit={(t) => patch({ rebate: Number(t) || 0 })} />
              </FieldRow>
              <FieldRow label="Yield" sub="Usable share after trim, e.g. 85">
                <InlineInput value={String(Math.round((Number(ing.yield_pct) || 1) * 1000) / 10)} suffix="%" onCommit={(t) => { const n = parsePercentInput(t); if (n != null && n > 0) patch({ yield_pct: n }); }} />
              </FieldRow>
              <Toggle label="Price Includes GST" checked={ing.price_inc_gst} onChange={(v) => patch({ price_inc_gst: v })} />
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
      {pending ? <CostImpactSheet ing={ing} pending={pending} onCancel={() => setPending(null)} onConfirm={() => void confirmPending()} /> : null}
      {review ? <ReviewSheet changes={review} onClose={() => setReview(null)} intro="This edit pushed these dishes below target. Nothing has changed on the menu yet." /> : null}
    </div>
  );
}

/** Ingredient fields that change what a unit costs. */
const COST_KEYS: (keyof Ingredient)[] = ["pack_size", "pack_unit", "yield_pct", "rebate", "price_inc_gst", "gst_free"];

interface PendingEdit {
  patch: Partial<Ingredient>;
  rows: ImpactRow[];
  /** cost per base unit before and after (ex GST) */
  before: number;
  after: number;
  /** relative move in unit cost */
  change: number;
  unitChanged: boolean;
}

/** "Yield 100% → 85%": what an Advanced edit changes, in words. */
function describeEdit(ing: Ingredient, p: Partial<Ingredient>): string {
  const parts: string[] = [];
  if (p.pack_size !== undefined) parts.push(`Pack size ${num(ing.pack_size)} → ${num(p.pack_size)}`);
  if (p.pack_unit !== undefined) parts.push(`Pack unit ${ing.pack_unit} → ${p.pack_unit}`);
  if (p.yield_pct !== undefined) parts.push(`Yield ${gp(ing.yield_pct, 0)} → ${gp(p.yield_pct, 0)}`);
  if (p.rebate !== undefined) parts.push(`Rebate ${money(ing.rebate)} → ${money(p.rebate)}`);
  if (p.price_inc_gst !== undefined) parts.push(p.price_inc_gst ? "Price now includes GST" : "Price now excludes GST");
  if (p.gst_free !== undefined) parts.push(p.gst_free ? "Marked GST-free" : "No longer GST-free");
  return parts.join(" · ");
}

/** Before/after GP of the dishes an ingredient edit touches, red when any fall below target. */
function ImpactPreview({ rows }: { rows: ImpactRow[] }) {
  const newlyUnder = rows.filter((r) => r.after.underTarget && !r.before.underTarget);
  if (!rows.length) return null;
  return (
    <div className={cx("mt-3 rounded-2xl px-4 py-3", newlyUnder.length ? "bg-danger-soft" : "bg-surface")}>
      <p className={cx("text-[15px] font-semibold", newlyUnder.length ? "text-danger" : "text-label")}>
        {newlyUnder.length
          ? `${newlyUnder.length} ${newlyUnder.length === 1 ? "dish falls" : "dishes fall"} below target`
          : `Changes ${rows.length} ${rows.length === 1 ? "dish" : "dishes"}, all still on target`}
      </p>
      <ul className="mt-1.5 space-y-1">
        {rows.slice(0, 4).map((r) => (
          <li key={r.item.id} className="flex items-baseline gap-2 text-[13px] tnum">
            <span className="min-w-0 flex-1 truncate text-label-2">{r.item.name}</span>
            <span className="shrink-0 text-label-2">{gp(r.before.gpPct, 0)} →</span>
            <span className={cx("shrink-0 font-semibold", r.after.underTarget ? "text-danger" : "text-label")}>{gp(r.after.gpPct, 0)}</span>
          </li>
        ))}
      </ul>
      {rows.length > 4 ? <p className="mt-1 text-[12px] text-label-3">and {rows.length - 4} more</p> : null}
    </div>
  );
}

/** Shown before an Advanced edit is saved when it moves the unit cost a lot or pushes a dish under target. */
function CostImpactSheet({ ing, pending, onCancel, onConfirm }: { ing: Ingredient; pending: PendingEdit; onCancel: () => void; onConfirm: () => void }) {
  const [busy, setBusy] = useState(false);
  const per = unitShort(ing.pack_unit);
  const dearer = pending.after > pending.before;
  return (
    <Sheet open onClose={onCancel} title="Cost Impact" action={{ label: busy ? "Saving…" : "Save", onClick: () => { setBusy(true); onConfirm(); }, disabled: busy }}>
      <div className="pb-2 pt-4">
        <p className="text-center text-[15px] text-label-2">{ing.name}</p>
        <p className="mt-1 text-center text-[15px] font-medium">{describeEdit(ing, pending.patch)}</p>
        <div className="mt-3 rounded-2xl bg-surface px-4 py-4 text-center">
          <p className="text-[13px] text-label-2">Cost per {per}, ex GST</p>
          <p className="mt-1 text-[28px] font-semibold tnum">
            {money(pending.before)} → <span className={dearer ? "text-danger" : "text-good"}>{money(pending.after)}</span>
          </p>
          {Math.abs(pending.change) > 1e-9 && Number.isFinite(pending.change) ? <p className={cx("mt-0.5 text-[15px] font-medium tnum", dearer ? "text-danger" : "text-good")}>{movePct(pending.change, 1)}</p> : null}
        </div>
        {pending.unitChanged ? <p className="mt-3 px-1 text-[13px] text-label-2">Changing the pack unit changes its family. Recipe lines in another unit will show a unit warning until you fix them.</p> : null}
        <ImpactPreview rows={pending.rows} />
        <button type="button" className="btn-primary mt-5 w-full" disabled={busy} onClick={() => { setBusy(true); onConfirm(); }}>
          {busy ? "Saving…" : "Save Change"}
        </button>
        <button type="button" className="btn-text mt-1 w-full justify-center" onClick={onCancel}>
          Leave It As It Is
        </button>
      </div>
    </Sheet>
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
    <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full text-accent" preserveAspectRatio="none" role="img" aria-label="Price Trend">
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
  const [changes, setChanges] = useState<ReviewChange[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const price = Number(text.replace(/[$,\s]/g, ""));
  const valid = text.trim() !== "" && Number.isFinite(price) && price >= 0;
  const move = valid ? priceMovePct(ing.pack_price, price) : null;
  // live preview: what this price does to every recipe using the ingredient, before saving
  const deferredPrice = useDeferredValue(valid ? price : null);
  const preview = useMemo(() => {
    if (deferredPrice == null || Math.abs(deferredPrice - Number(ing.pack_price)) < 1e-9) return null;
    const p: Partial<Ingredient> = { pack_price: deferredPrice };
    if (incGst !== ing.price_inc_gst) p.price_inc_gst = incGst;
    return ingredientChangeImpact(ing.id, p, { ...store, lines: store.allLines });
  }, [deferredPrice, incGst, ing, store]);

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const p: Partial<Ingredient> = { pack_price: price, source: note.trim() || "Invoice" };
    if (incGst !== ing.price_inc_gst) p.price_inc_gst = incGst;
    const rows = ingredientChangeImpact(ing.id, p, { ...store, lines: store.allLines });
    try {
      await store.updateIngredient(ing.id, p);
      setChanges(reviewChangesFromImpact(rows.filter((r) => r.after.underTarget), store.itemCosts.values(), store.settings.gst_rate));
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
      <Sheet open onClose={onClose} title="Price Updated" cancelLabel={null} action={{ label: "Done", onClick: onClose }}>
        <div className="pb-2 pt-4">
          <p className="text-center text-[15px] text-label-2">{ing.name}</p>
          <p className="text-center text-[34px] font-semibold tnum">{money(price)}</p>
          {changes.length ? (
            <div className="mt-4 rounded-2xl bg-danger-soft px-4 py-3">
              <p className="text-[15px] font-semibold text-danger">
                {changes.length} {changes.length === 1 ? "price is" : "prices are"} now below target
              </p>
              <p className="mt-0.5 text-[13px] text-label-2">Nothing has changed on the menu. Review the suggested prices and decide.</p>
              <button type="button" className="btn-primary mt-3 w-full" onClick={() => setReviewing(true)}>
                Review &amp; Apply
              </button>
            </div>
          ) : null}
          {impact.length === 0 ? (
            <p className="py-6 text-center text-[15px] text-label-2">Not used in any recipe — nothing else changes.</p>
          ) : (
            <Group title={`Used In ${impact.length} ${impact.length === 1 ? "Recipe" : "Recipes"}`} className="mt-4">
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
                      r.after.underTarget && r.after.sellInc != null ? (
                        <span className="tnum">
                          <span className="text-label-2">GP {gp(r.before.gpPct, 0)} → </span>
                          <span className="font-semibold text-danger">{gp(r.after.gpPct, 0)}</span>
                        </span>
                      ) : r.before.gpPct == null ? (
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
          {reviewing ? <ReviewSheet changes={changes} onClose={() => setReviewing(false)} onDone={onClose} intro="This price change pushed these dishes below target. Nothing has changed on the menu yet." /> : null}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={onClose} title="Update Price" action={{ label: busy ? "Saving…" : "Save", onClick: () => void save(), disabled: !valid || busy }}>
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
            aria-label="New Pack Price"
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
        {preview && preview.length ? <ImpactPreview rows={preview} /> : null}
        <div className="group-list mt-4">
          <Toggle checked={incGst} onChange={setIncGst} label="Price Includes GST" />
          <div className="px-4">
            <input className="h-11 w-full bg-transparent text-[17px] outline-none placeholder:text-label-3 sm:text-[15px]" placeholder="Invoice / note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <button type="submit" className="btn-primary mt-5 w-full" disabled={!valid || busy}>
          {busy ? "Saving…" : "Save Price"}
        </button>
      </form>
    </Sheet>
  );
}
