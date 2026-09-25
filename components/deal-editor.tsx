"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import { useStore } from "@/lib/store";
import { ingredientCostPerBase } from "@/lib/costing";
import {
  brisbaneToday,
  daysBetween,
  DEAL_KINDS,
  DEAL_STATUS_LABEL,
  dealStatus,
  dealSummary,
  parseDealFromText,
  resolveDeals,
  type DealStatus,
  type SuggestedDeal,
} from "@/lib/deals";
import { ingredientChangeImpact, type ImpactRow } from "@/lib/insights";
import { reviewChangesFromImpact, type ReviewChange } from "@/lib/price-review";
import { dateShort, money, movePct, unitShort } from "@/lib/format";
import type { DealKind, Ingredient, IngredientDeal } from "@/lib/types";
import { ReviewSheet } from "@/components/price-review";
import { Banner, cx, Group, Row, Segmented, Sheet } from "@/components/ui";

/** Renders the before/after dishes for a change (the ingredient page's own preview, passed in so it is reused, not copied). */
export type RenderImpact = (rows: ImpactRow[]) => React.ReactNode;

const STATUS_STYLE: Record<DealStatus, string> = {
  active: "bg-good-soft text-good",
  upcoming: "bg-accent-soft text-accent",
  ending_soon: "bg-warn-soft text-warn",
  expired: "bg-fill text-label-2",
  off: "bg-fill text-label-2",
};

export function StatusChip({ status }: { status: DealStatus }) {
  return <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold leading-5", STATUS_STYLE[status])}>{DEAL_STATUS_LABEL[status]}</span>;
}

const basisText = (ing: Pick<Ingredient, "gst_free" | "price_inc_gst">) => (ing.gst_free ? "GST-free" : ing.price_inc_gst ? "inc GST" : "ex GST");

/** The big pack price on the ingredient page: the effective price, with the base price struck through while a deal is live. */
export function DealPriceBlock({ ing, updatedText }: { ing: Ingredient; updatedText?: string }) {
  const store = useStore();
  const gst = store.settings.gst_rate;
  const res = useMemo(() => resolveDeals(Number(ing.pack_price), store.dealsByIngredient.get(ing.id)), [ing.pack_price, ing.id, store.dealsByIngredient]);
  const unitCost = ingredientCostPerBase({ ...ing, pack_price: res.price }, gst);
  return (
    <>
      <p className="text-[15px] font-medium text-label-2">{res.deal ? "Pack price with deal" : "Pack price"}</p>
      <p className="display mt-1 text-[64px] tnum text-accent">
        {money(res.price)}
        {res.deal ? <span className="ml-3 align-middle text-[28px] text-label-3 line-through decoration-2">{money(res.base)}</span> : null}
      </p>
      <p className="mt-2 text-[15px] text-label-2 tnum">
        {basisText(ing)} · {money(unitCost)}/{unitShort(ing.pack_unit)}
        {res.deal ? ` · ${Math.round(res.savingPct * 1000) / 10}% off` : ""}
        {updatedText ?? ""}
      </p>
      {res.deal ? <p className="mt-1 text-[13px] text-label-2">Costing uses the deal price until it ends.</p> : null}
    </>
  );
}

/** Everything the supplier's own wording says about this ingredient, for spotting "8+1" style deals. */
function useSuggestion(ing: Ingredient): SuggestedDeal | null {
  const store = useStore();
  const { loadPortalPrices, portalPrices } = store;
  useEffect(() => {
    loadPortalPrices();
  }, [loadPortalPrices]);
  return useMemo(() => {
    const code = ing.supplier_code?.trim().toLowerCase();
    const portal = code ? portalPrices?.find((p) => p.product_code?.trim().toLowerCase() === code) : undefined;
    for (const text of [portal?.description, ing.name, ing.notes, ing.supplier_code]) {
      const s = parseDealFromText(text);
      if (s) return s;
    }
    return null;
  }, [ing.supplier_code, ing.name, ing.notes, portalPrices]);
}

export function DealsSection({ ing, adding, onAddingChange, renderImpact }: { ing: Ingredient; adding: boolean; onAddingChange: (v: boolean) => void; renderImpact: RenderImpact }) {
  const store = useStore();
  const today = brisbaneToday();
  const deals = store.dealsByIngredient.get(ing.id) ?? [];
  const suggestion = useSuggestion(ing);
  const [prefill, setPrefill] = useState<SuggestedDeal | null>(null);
  const [removing, setRemoving] = useState<IngredientDeal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const res = resolveDeals(Number(ing.pack_price), deals, today);
  // hide the suggestion once a deal of that kind already exists
  const showSuggestion = suggestion && !deals.some((d) => d.kind === suggestion.kind);
  const ordered = [...deals].sort((a, b) => (a.ends_on ?? "9999").localeCompare(b.ends_on ?? "9999"));

  const run = (p: Promise<unknown>) => p.catch((e) => setError(e instanceof Error ? e.message : String(e)));
  const removeDeal = (d: IngredientDeal) => {
    // dishes only get dearer when a live deal goes: show them first when any would fall below target
    const rows = ingredientChangeImpact(ing.id, {}, { ...store, lines: store.allLines, dealsAfter: store.deals.filter((x) => x.id !== d.id) });
    if (rows.some((r) => r.after.underTarget && !r.before.underTarget)) setRemoving(d);
    else void run(store.deleteDeal(d.id));
  };

  return (
    <>
      <Group
        title={deals.length ? `Deals · ${deals.length}` : "Deals"}
        className="mt-7"
        footer="The lowest price wins. Deals do not stack, except a standing percent off, which applies first. A deal stops costing on its end date and the base price comes back."
      >
        {error ? <Banner>{error}</Banner> : null}
        {res.deal ? (
          <Row title={<span className="tnum">Costing at {money(res.price)} a pack</span>} sub={`${Math.round(res.savingPct * 1000) / 10}% below the ${money(res.base)} base price`} />
        ) : null}
        {ordered.map((d) => {
          const s = dealStatus(d, today);
          const left = d.ends_on ? daysBetween(today, d.ends_on) : null;
          const timing = s === "expired" && left != null ? `Ended ${-left} ${left === -1 ? "day" : "days"} ago` : s === "ending_soon" && left != null ? (left === 0 ? "Ends today" : left === 1 ? "Ends tomorrow" : `Ends in ${left} days`) : s === "upcoming" && d.starts_on ? `Starts ${dateShort(d.starts_on)}` : null;
          const sub = [timing, d.note].filter(Boolean).join(" · ") || undefined;
          return (
            <div key={d.id}>
              <Row title={dealSummary(d)} sub={sub} wrapSub titleClassName="!whitespace-normal" trailing={<StatusChip status={s} />} />
              <div className="flex gap-2 px-4 pb-3">
                <button type="button" className="btn-plain flex-1" onClick={() => void run(store.updateDeal(d.id, { active: !d.active }))}>
                  {d.active ? "Turn Off" : "Turn On"}
                </button>
                <button type="button" className="btn-plain flex-1 !text-danger" onClick={() => removeDeal(d)}>
                  Delete
                </button>
              </div>
            </div>
          );
        })}
        {showSuggestion ? (
          <Row
            onClick={() => {
              setPrefill(suggestion);
              onAddingChange(true);
            }}
            leading={
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-accent">
                <Sparkles className="h-[18px] w-[18px]" strokeWidth={2.25} />
              </span>
            }
            title={<span className="font-medium text-accent">Apply Suggested Deal</span>}
            sub={`Found ${suggestion.matched} in the supplier description. Check it, then save.`}
            wrapSub
            chevron
          />
        ) : null}
        <Row
          onClick={() => {
            setPrefill(null);
            onAddingChange(true);
          }}
          leading={
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-accent">
              <Plus className="h-[18px] w-[18px]" strokeWidth={2.5} />
            </span>
          }
          title={<span className="font-medium text-accent">Add Deal</span>}
          sub={deals.length ? undefined : "Buy X get Y free, volume, special price or percent off"}
          wrapSub
        />
      </Group>
      {adding ? <DealSheet key={prefill ? "s" : "n"} ing={ing} prefill={prefill} onClose={() => onAddingChange(false)} renderImpact={renderImpact} /> : null}
      {removing ? <RemoveDealSheet ing={ing} deal={removing} onClose={() => setRemoving(null)} renderImpact={renderImpact} /> : null}
    </>
  );
}

/** Deleting a live deal that would push dishes under target: show them, then offer Review & Apply. */
function RemoveDealSheet({ ing, deal, onClose, renderImpact }: { ing: Ingredient; deal: IngredientDeal; onClose: () => void; renderImpact: RenderImpact }) {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changes, setChanges] = useState<ReviewChange[] | null>(null);
  const rows = useMemo(
    () => ingredientChangeImpact(ing.id, {}, { ...store, lines: store.allLines, dealsAfter: store.deals.filter((x) => x.id !== deal.id) }),
    [ing.id, store, deal.id],
  );
  async function remove() {
    setBusy(true);
    try {
      const review = reviewChangesFromImpact(rows.filter((r) => r.after.underTarget), store.itemCosts.values(), store.settings.gst_rate);
      await store.deleteDeal(deal.id);
      if (review.length) setChanges(review);
      else onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }
  if (changes) return <ReviewSheet changes={changes} onClose={onClose} intro="Removing the deal pushed these dishes below target. Nothing has changed on the menu yet." />;
  return (
    <Sheet open onClose={onClose} title="Remove Deal" action={{ label: busy ? "Removing…" : "Remove", onClick: () => void remove(), disabled: busy, destructive: true }}>
      <div className="pb-2 pt-4">
        {error ? <Banner>{error}</Banner> : null}
        <p className="text-center text-[15px] text-label-2">{ing.name}</p>
        <p className="mt-1 text-center text-[15px] font-medium">{dealSummary(deal)}</p>
        <p className="mt-2 text-center text-[13px] text-label-2">Without this deal the ingredient costs its base price again.</p>
        {renderImpact(rows)}
        <button type="button" className="btn-primary mt-5 w-full !bg-danger" disabled={busy} onClick={() => void remove()}>
          {busy ? "Removing…" : "Remove Deal"}
        </button>
        <button type="button" className="btn-text mt-1 w-full justify-center" onClick={onClose}>
          Keep The Deal
        </button>
      </div>
    </Sheet>
  );
}

const num = (t: string): number => {
  const v = Number(t.replace(/[$,%\s]/g, ""));
  return Number.isFinite(v) ? v : 0;
};
const pctFrac = (t: string): number => num(t) / 100;

function DealSheet({ ing, prefill, onClose, renderImpact }: { ing: Ingredient; prefill: SuggestedDeal | null; onClose: () => void; renderImpact: RenderImpact }) {
  const store = useStore();
  const gst = store.settings.gst_rate;
  const today = brisbaneToday();
  const [kind, setKind] = useState<DealKind>(prefill?.kind ?? "buy_x_get_y");
  const [buy, setBuy] = useState(prefill?.buy_qty ? String(prefill.buy_qty) : "");
  const [free, setFree] = useState(prefill?.free_qty ? String(prefill.free_qty) : "");
  const [minQty, setMinQty] = useState("");
  const [volMode, setVolMode] = useState<"pct" | "price">("pct");
  const [pct, setPct] = useState(prefill?.pct_off ? String(Math.round(prefill.pct_off * 1000) / 10) : "");
  const [price, setPrice] = useState("");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft: IngredientDeal = useMemo(
    () => ({
      id: "draft",
      ingredient_id: ing.id,
      kind,
      buy_qty: kind === "buy_x_get_y" ? num(buy) || null : null,
      free_qty: kind === "buy_x_get_y" ? num(free) || null : null,
      min_qty: kind === "volume" ? num(minQty) || null : null,
      pct_off: kind === "percent_off" || (kind === "volume" && volMode === "pct") ? pctFrac(pct) || null : null,
      unit_price: kind === "volume" && volMode === "price" ? num(price) || null : null,
      special_pack_price: kind === "special_price" ? num(price) || null : null,
      starts_on: starts || null,
      ends_on: ends || null,
      note: note.trim() || null,
      active: true,
    }),
    [ing.id, kind, buy, free, minQty, volMode, pct, price, starts, ends, note],
  );
  const problem = useMemo(() => {
    if (starts && ends && starts > ends) return "The end date is before the start date.";
    if (kind === "buy_x_get_y" && !(num(buy) > 0 && num(free) > 0)) return "Enter how many you buy and how many come free.";
    if (kind === "volume") {
      if (!(num(minQty) > 0)) return "Enter the minimum number of packs.";
      if (volMode === "pct" ? !(pctFrac(pct) > 0 && pctFrac(pct) < 1) : !(num(price) > 0)) return volMode === "pct" ? "Enter the percentage off." : "Enter the pack price at that quantity.";
    }
    if (kind === "special_price" && !(num(price) > 0)) return "Enter the special pack price.";
    if (kind === "percent_off" && !(pctFrac(pct) > 0 && pctFrac(pct) < 1)) return "Enter a percentage between 0 and 100.";
    return null;
  }, [kind, buy, free, minQty, volMode, pct, price, starts, ends]);
  const valid = !problem;

  // What the price would be once this deal is running, next to the deals already on file (dates ignored for the draft).
  const others = useMemo(() => (store.dealsByIngredient.get(ing.id) ?? []), [store.dealsByIngredient, ing.id]);
  const running = useMemo(() => ({ ...draft, starts_on: null, ends_on: null }), [draft]);
  const now = useMemo(() => resolveDeals(Number(ing.pack_price), others, today), [ing.pack_price, others, today]);
  const withDraft = useMemo(() => (valid ? resolveDeals(Number(ing.pack_price), [...others, running], today) : null), [valid, ing.pack_price, others, running, today]);
  const wins = withDraft?.deal?.id === "draft";
  const effective = wins ? withDraft!.price : now.price;
  const perUnit = ingredientCostPerBase({ ...ing, pack_price: effective }, gst);
  const saving = Number(ing.pack_price) > 0 ? 1 - effective / Number(ing.pack_price) : 0;

  const deferredDraft = useDeferredValue(valid ? running : null);
  const rows = useMemo(() => {
    if (!deferredDraft) return null;
    return ingredientChangeImpact(ing.id, {}, { ...store, lines: store.allLines, dealsAfter: [...store.deals, deferredDraft] });
  }, [deferredDraft, ing.id, store]);
  const upcoming = starts && starts > today;

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { id: _id, ...row } = draft;
      void _id;
      await store.addDeal(row);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const field = (label: string, el: React.ReactNode, help?: string) => (
    <div>
      <p className="section-label !px-1">{label}</p>
      {el}
      {help ? <p className="px-1 pt-1 text-[13px] text-label-2">{help}</p> : null}
    </div>
  );
  const numInput = (value: string, set: (v: string) => void, label: string, opts?: { prefix?: string; suffix?: string; placeholder?: string }) => (
    <div className="relative">
      {opts?.prefix ? <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[17px] text-label-2 sm:text-[15px]">{opts.prefix}</span> : null}
      <input className={cx("field tnum", opts?.prefix && "pl-7", opts?.suffix && "pr-8")} inputMode="decimal" aria-label={label} placeholder={opts?.placeholder ?? "0"} value={value} onChange={(e) => set(e.target.value)} />
      {opts?.suffix ? <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[17px] text-label-2 sm:text-[15px]">{opts.suffix}</span> : null}
    </div>
  );

  return (
    <Sheet open onClose={onClose} title="Add Deal" size="lg" action={{ label: busy ? "Saving…" : "Save", onClick: () => void save(), disabled: !valid || busy }}>
      <form
        className="space-y-4 pb-2 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error ? <Banner>{error}</Banner> : null}
        <p className="px-1 text-center text-[15px] text-label-2">
          {ing.name} · base price {money(ing.pack_price)} {basisText(ing)}
        </p>
        <div role="radiogroup" aria-label="Deal type" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {DEAL_KINDS.map((k) => {
            const on = k.value === kind;
            return (
              <button
                key={k.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setKind(k.value)}
                className={cx(
                  "min-h-[44px] rounded-xl px-3 text-[15px] font-medium transition active:scale-[0.98] sm:min-h-[40px] sm:text-[14px]",
                  on ? "bg-accent-fill text-accent-on" : "bg-surface text-label shadow-[inset_0_0_0_0.5px_var(--separator)]",
                )}
              >
                {k.label}
              </button>
            );
          })}
        </div>
        <p className="px-1 text-[13px] text-label-2">{DEAL_KINDS.find((k) => k.value === kind)?.hint}. Enter prices the way the pack price is entered ({basisText(ing)}).</p>

        {kind === "buy_x_get_y" ? (
          <div className="grid grid-cols-2 gap-3">
            {field("Buy", numInput(buy, setBuy, "Buy quantity", { placeholder: "8" }))}
            {field("Get Free", numInput(free, setFree, "Free quantity", { placeholder: "1" }))}
          </div>
        ) : null}

        {kind === "volume" ? (
          <>
            {field("Minimum Packs", numInput(minQty, setMinQty, "Minimum packs", { placeholder: "10" }), "Costing assumes you order at least this many.")}
            <Segmented ariaLabel="Volume discount type" value={volMode} onChange={setVolMode} options={[{ value: "pct", label: "Percent Off" }, { value: "price", label: "Lower Pack Price" }]} />
            {volMode === "pct" ? field("Percent Off", numInput(pct, setPct, "Percent off", { suffix: "%", placeholder: "5" })) : field("Pack Price At That Quantity", numInput(price, setPrice, "Pack price at minimum quantity", { prefix: "$", placeholder: "0.00" }))}
          </>
        ) : null}

        {kind === "special_price" ? field("Special Pack Price", numInput(price, setPrice, "Special pack price", { prefix: "$", placeholder: "0.00" })) : null}
        {kind === "percent_off" ? field("Percent Off", numInput(pct, setPct, "Percent off", { suffix: "%", placeholder: "5" }), "A standing rebate. It applies to the base price before any other deal.") : null}

        <div className="grid grid-cols-2 gap-3">
          {field("Starts (Optional)", <input type="date" className="field" aria-label="Start date" value={starts} onChange={(e) => setStarts(e.target.value)} />)}
          {field("Ends (Optional)", <input type="date" className="field" aria-label="End date" value={ends} onChange={(e) => setEnds(e.target.value)} />)}
        </div>
        <input className="field" placeholder="Note (optional)" aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} />

        {/* live result */}
        <div className="rounded-2xl bg-surface px-4 py-4 text-center">
          {valid ? (
            <>
              <p className="text-[13px] text-label-2">Effective pack price</p>
              <p className="mt-1 text-[34px] font-semibold leading-none tnum">
                {effective < Number(ing.pack_price) - 1e-9 ? <span className="mr-2 text-[20px] font-normal text-label-3 line-through">{money(ing.pack_price)}</span> : null}
                <span className={saving > 1e-9 ? "text-good" : undefined}>{money(effective)}</span>
              </p>
              <p className="mt-2 text-[15px] text-label-2 tnum">
                {saving > 1e-9 ? `${Math.round(saving * 1000) / 10}% saving` : "No saving"} · {money(perUnit)} per {unitShort(ing.pack_unit)} ex GST
              </p>
              {!wins ? <p className="mt-1.5 text-[13px] text-warn">Another deal on file is already cheaper, so this one would not change costing.</p> : null}
              {upcoming ? <p className="mt-1.5 text-[13px] text-label-2">Starts {dateShort(starts)}. Costing stays on today&apos;s price until then.</p> : null}
              {wins && withDraft!.warnings.length ? <p className="mt-1.5 text-[13px] text-warn">{withDraft!.warnings[0]}</p> : null}
            </>
          ) : (
            <p className="text-[15px] text-label-2">{problem}</p>
          )}
        </div>
        {rows && rows.length ? (
          <div>
            <p className="px-1 text-[13px] text-label-2">Affects {rows.length} {rows.length === 1 ? "dish" : "dishes"} once it is running{effective !== now.price && now.price > 0 ? ` (${movePct((effective - now.price) / now.price, 1)} on cost)` : ""}.</p>
            {renderImpact(rows)}
          </div>
        ) : rows ? (
          <p className="px-1 text-[13px] text-label-2">Not used in any recipe, so no dishes change.</p>
        ) : null}

        <button type="submit" className="btn-primary w-full" disabled={!valid || busy}>
          {busy ? "Saving…" : "Save Deal"}
        </button>
      </form>
    </Sheet>
  );
}
