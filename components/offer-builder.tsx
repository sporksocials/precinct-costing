"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ChevronLeft, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { costOffer, dayName, OFFER_KINDS, OFFER_STATUSES, offerLineCostId } from "@/lib/offers";
import { gp, money } from "@/lib/format";
import { parseGpInput, parsePriceInput } from "@/lib/solver";
import type { Offer, OfferAssumptions, OfferKind, OfferLine, OfferStatus } from "@/lib/types";
import { VenueAccent, VENUE_SHORT } from "./venue";
import { OfferSimulator, priceBreakEvenLabel, simInputFrom } from "./offer-simulator";
import { ComponentPicker, StatusPill, type NewOfferLine } from "./offers-parts";
import { Banner, Chips, cx, FieldRow, Group, InlineInput, Row, Stepper, useToast } from "./ui";

export interface Draft {
  name: string;
  kind: OfferKind;
  venueId: number | null;
  price: string;
  target: string;
  status: OfferStatus;
  startsOn: string;
  endsOn: string;
  days: number[];
  timeFrom: string;
  timeTo: string;
  notes: string;
  /** Sales Needed simulator inputs; never prices */
  assumptions: OfferAssumptions;
  lines: NewOfferLine[];
}

export function emptyDraft(venueId: number | null, kind: OfferKind = "combo"): Draft {
  return { name: "", kind, venueId, price: "", target: "", status: "draft", startsOn: "", endsOn: "", days: [], timeFrom: "", timeTo: "", notes: "", assumptions: {}, lines: [] };
}

export function draftFromOffer(o: Offer, lines: OfferLine[]): Draft {
  return {
    name: o.name,
    kind: o.kind,
    venueId: o.venue_id,
    price: o.price_inc != null ? Number(o.price_inc).toFixed(2) : "",
    target: o.target_override != null ? String(Math.round(Number(o.target_override) * 1000) / 10) : "",
    status: o.status,
    startsOn: o.starts_on ?? "",
    endsOn: o.ends_on ?? "",
    days: o.days_of_week ?? [],
    timeFrom: (o.time_from ?? "").slice(0, 5),
    timeTo: (o.time_to ?? "").slice(0, 5),
    notes: o.notes ?? "",
    assumptions: o.assumptions ?? {},
    lines: [...lines].sort((a, b) => a.sort - b.sort).map(({ id: _i, offer_id: _o, ...l }) => l),
  };
}

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const same = (a: NewOfferLine, b: NewOfferLine) => a.component_kind === b.component_kind && a.item_id === b.item_id && a.beer_id === b.beer_id && a.serve_id === b.serve_id;

/** The offer builder: everything is local until Save, so the numbers are always "before saving". */
export function OfferBuilder({ offerId, initial }: { offerId: string | null; initial: Draft }) {
  const store = useStore();
  const router = useRouter();
  const toast = useToast();
  const [d, setD] = useState<Draft>(initial);
  const [base, setBase] = useState(() => JSON.stringify(initial));
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const setAssumptions = (p: Partial<OfferAssumptions>) => setD((x) => ({ ...x, assumptions: { ...x.assumptions, ...p } }));
  const dirty = JSON.stringify(d) !== base;
  const venue = d.venueId != null ? store.venueById.get(d.venueId) : undefined;
  const saved = offerId ? store.offers.find((o) => o.id === offerId) : undefined;

  const price = parsePriceInput(d.price);
  const targetOverride = d.target.trim() ? parseGpInput(d.target) : null;
  const liveLines: OfferLine[] = useMemo(() => d.lines.map((l, i) => ({ ...l, id: `draft-${i}`, offer_id: offerId ?? "new", sort: i })), [d.lines, offerId]);
  const c = useMemo(
    () => costOffer({ price_inc: price, target_override: targetOverride }, liveLines, { itemCosts: store.itemCosts, settings: store.settings }),
    [price, targetOverride, liveLines, store.itemCosts, store.settings],
  );
  const simInput = useMemo(() => simInputFrom(c, d.assumptions, store.settings.gst_rate), [c, d.assumptions, store.settings.gst_rate]);
  const savedCost = offerId ? store.offerCosts.get(offerId) : undefined;
  const windowKind = d.kind !== "combo";
  const canSave = !!d.name.trim() && d.venueId != null && d.lines.length > 0 && !busy;
  const good = c.gpPct != null && !c.underTarget;

  function addLine(l: NewOfferLine) {
    setD((x) => {
      const i = x.lines.findIndex((y) => same(y, l));
      if (i >= 0) return { ...x, lines: x.lines.map((y, j) => (j === i ? { ...y, qty: y.qty + 1 } : y)) };
      return { ...x, lines: [...x.lines, l] };
    });
  }

  async function save() {
    if (!canSave || d.venueId == null) return;
    setBusy(true);
    setError(null);
    const row = {
      name: d.name.trim(),
      venue_id: d.venueId,
      kind: d.kind,
      status: d.status,
      price_inc: price,
      target_override: targetOverride,
      starts_on: windowKind && d.startsOn ? d.startsOn : null,
      ends_on: windowKind && d.endsOn ? d.endsOn : null,
      days_of_week: windowKind && d.days.length ? [...d.days].sort() : null,
      time_from: windowKind && d.timeFrom ? d.timeFrom : null,
      time_to: windowKind && d.timeTo ? d.timeTo : null,
      notes: d.notes.trim() || null,
      assumptions: d.assumptions,
    };
    try {
      if (offerId) {
        await store.updateOffer(offerId, row);
        await store.setOfferLines(offerId, d.lines);
        setBase(JSON.stringify(d));
        toast.show({ message: "Saved" });
      } else {
        const id = await store.createOffer(row, d.lines);
        router.replace(`/specials/${id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(status: OfferStatus) {
    if (status === d.status) return;
    if (!offerId) return set({ status });
    setError(null);
    try {
      await store.setOfferStatus(offerId, status);
      set({ status });
      setBase((b) => JSON.stringify({ ...JSON.parse(b), status }));
      toast.show({ message: status === "live" ? "Offer is Live" : status === "retired" ? "Offer retired" : "Back to Draft" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const lineName = (i: number) => c.lines[i]?.name ?? "";

  return (
    <div className="max-w-5xl lg:pt-6">
      <VenueAccent slug={venue?.slug} />
      <Link href="/specials" className="btn-text -ml-1 !gap-0 !text-accent">
        <ChevronLeft className="h-6 w-6" strokeWidth={2.25} />
        Specials
      </Link>
      <div className="mt-2 flex items-center gap-2">
        <h1 className="min-w-0 truncate text-[28px] font-bold leading-tight tracking-tight lg:text-[32px]">{d.name.trim() || "New Offer"}</h1>
        <StatusPill status={d.status} />
      </div>
      <p className="mt-1 text-[15px] text-label-2">{offerId ? "Saved separately from the master menu." : "Not saved yet. Try prices here, then save it as a Draft."}</p>
      {error ? <Banner>{error}</Banner> : null}

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-x-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <input className="field !text-[20px] font-semibold" placeholder="Name, e.g. Pot And Parma" value={d.name} onChange={(e) => set({ name: e.target.value })} aria-label="Offer name" />

          <p className="section-label !px-1 mt-5">Type</p>
          <Chips ariaLabel="Offer type" value={d.kind} onChange={(kind) => set({ kind })} options={OFFER_KINDS.map((k) => ({ value: k.value, label: k.label }))} />

          <p className="section-label !px-1 mt-5">Venue</p>
          <div className={cx(d.lines.length > 0 && "pointer-events-none opacity-50")} aria-disabled={d.lines.length > 0}>
            <Chips
              ariaLabel="Venue"
              value={d.venueId != null ? String(d.venueId) : ""}
              onChange={(v) => set({ venueId: Number(v) })}
              options={store.venues.map((v) => ({ value: String(v.id), label: VENUE_SHORT[v.slug] ?? v.name, className: d.venueId === v.id ? `v-${v.slug}` : undefined }))}
            />
          </div>
          <p className="px-1 pt-1.5 text-[13px] text-label-2">{d.lines.length ? "The venue is fixed once there are components. Remove them to change it." : "Every component comes from this venue."}</p>

          <Group title={`Components · ${d.lines.length}`} className="mt-6" footer="Costs come from the live recipes, so a supplier price change updates this offer.">
            {d.lines.map((l, i) => {
              const lc = c.lines[i];
              return (
                <div key={`${offerLineCostId(l as OfferLine) ?? "x"}-${i}`} className="flex min-h-[60px] items-center gap-2 py-2 pl-4 pr-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[17px] leading-snug sm:text-[15px]">{lineName(i) || "Removed item"}</span>
                    <span className={cx("block truncate text-[13px] tnum", lc?.missing ? "text-warn" : "text-label-2")}>
                      {lc?.missing === "deleted" ? "This item was removed. Remove it here." : lc?.missing === "no_price" ? "No regular price set" : lc?.missing === "no_cost" ? "Costs $0. Check the recipe" : `cost ${money(lc?.cost)} · regular ${money(lc?.regularInc)}`}
                    </span>
                  </span>
                  <Stepper value={l.qty} onChange={(qty) => set({ lines: d.lines.map((y, j) => (j === i ? { ...y, qty } : y)) })} />
                  <button type="button" aria-label={`Remove ${lineName(i)}`} className="flex h-11 w-11 shrink-0 items-center justify-center text-label-2" onClick={() => set({ lines: d.lines.filter((_, j) => j !== i) })}>
                    <X className="h-5 w-5" />
                  </button>
                </div>
              );
            })}
            <Row onClick={() => setPicking(true)} title={<span className="text-accent">Add Component</span>} />
          </Group>

          {windowKind ? (
            <Group title="When It Runs" className="mt-6" footer="Blank days mean every day, blank times mean all day. Brisbane time.">
              <div className="flex flex-wrap gap-2 px-4 py-3" role="group" aria-label="Days">
                {DAY_ORDER.map((n) => {
                  const on = d.days.includes(n);
                  return (
                    <button key={n} type="button" aria-pressed={on} onClick={() => set({ days: on ? d.days.filter((x) => x !== n) : [...d.days, n] })} className={cx("h-11 min-w-[46px] rounded-full px-3 text-[15px] font-medium sm:h-9", on ? "bg-accent-fill text-accent-on" : "bg-fill text-label")}>
                      {dayName(n)}
                    </button>
                  );
                })}
              </div>
              <FieldRow label="From Time">
                <input type="time" aria-label="From time" className="field !w-auto !py-1.5" value={d.timeFrom} onChange={(e) => set({ timeFrom: e.target.value })} />
              </FieldRow>
              <FieldRow label="To Time">
                <input type="time" aria-label="To time" className="field !w-auto !py-1.5" value={d.timeTo} onChange={(e) => set({ timeTo: e.target.value })} />
              </FieldRow>
              <FieldRow label="Starts On">
                <input type="date" aria-label="Starts on" className="field !w-auto !py-1.5" value={d.startsOn} onChange={(e) => set({ startsOn: e.target.value })} />
              </FieldRow>
              <FieldRow label="Ends On">
                <input type="date" aria-label="Ends on" className="field !w-auto !py-1.5" value={d.endsOn} onChange={(e) => set({ endsOn: e.target.value })} />
              </FieldRow>
            </Group>
          ) : null}

          <p className="section-label !px-1 mt-6">Notes</p>
          <textarea className="field min-h-[72px]" placeholder="Anything the team should know" value={d.notes} onChange={(e) => set({ notes: e.target.value })} aria-label="Notes" />
        </div>

        <div className="mt-6 lg:col-start-2 lg:row-start-1 lg:mt-0">
          <div>
            <section className="rounded-2xl bg-surface px-4 py-4" aria-label="Offer totals">
              <p className="eyebrow text-[12px] text-label-2">Impact Before Saving</p>
              <p className={cx("display mt-1 text-[64px] leading-none tnum", c.gpPct == null ? "text-label-3" : good ? "text-good" : "text-danger")}>{gp(c.gpPct)}</p>
              <p className="mt-1 text-[15px] text-label-2 tnum">
                GP {c.gpDollars != null ? money(c.gpDollars) : "—"} ex GST · target {gp(c.targetGp, 0)}
                {c.targetSource === "dominant" && c.targetFrom ? ` (from ${c.targetFrom})` : c.targetSource === "override" ? " (yours)" : ""}
              </p>
              {c.belowCost ? <p className="mt-2 text-[15px] font-semibold text-danger">Sells for less than it costs.</p> : null}
              {c.missing.length ? <p className="mt-2 text-[13px] text-warn">{c.missing.length} {c.missing.length === 1 ? "component needs" : "components need"} attention, so these numbers may be off.</p> : null}
              {c.needsCheck ? <p className="mt-1 text-[13px] text-warn">A component’s cost looks wrong. Check its recipe.</p> : null}

              <dl className="mt-4 divide-y divide-[color:var(--separator)] text-[17px] sm:text-[15px]">
                <div className="flex justify-between py-2">
                  <dt className="text-label-2">Cost (ex GST)</dt>
                  <dd className="tnum">{money(c.cost)}</dd>
                </div>
                <div className="flex justify-between py-2">
                  <dt className="text-label-2">Regular Price</dt>
                  <dd className="tnum">{c.lines.length ? `${money(c.regularPriceInc)}${c.regularComplete ? "" : "+"}` : "—"}</dd>
                </div>
                <div className="flex items-center justify-between py-1.5">
                  <dt className="text-label-2">Offer Price</dt>
                  <dd>
                    <InlineInput value={d.price} placeholder="0.00" prefix="$" onCommit={(t) => set({ price: t })} />
                  </dd>
                </div>
                <div className="flex justify-between py-2">
                  <dt className="text-label-2">Discount</dt>
                  <dd className="tnum">{c.discountInc != null && c.discountPct != null ? `${money(c.discountInc)} · ${gp(c.discountPct, 0)}` : "—"}</dd>
                </div>
                <div className="flex items-center justify-between py-1.5">
                  <dt className="text-label-2">Target GP</dt>
                  <dd>
                    <InlineInput value={d.target} placeholder={`Auto ${Math.round(c.targetGp * 100)}`} suffix="%" onCommit={(t) => set({ target: t })} />
                  </dd>
                </div>
              </dl>
              {dirty && savedCost && savedCost.gpPct != null ? <p className="mt-2 text-[13px] text-label-2 tnum">Saved version: {money(savedCost.offerPriceInc)} · GP {gp(savedCost.gpPct)}</p> : null}

              {c.suggestedPriceInc != null ? (
                c.underTarget || price == null ? (
                  <button type="button" className="btn-tinted mt-3 w-full" onClick={() => set({ price: c.suggestedPriceInc!.toFixed(2) })}>
                    Set {money(c.suggestedPriceInc)} For {gp(c.targetGp, 0)}
                  </button>
                ) : null
              ) : null}

              {c.ladder.length ? (
                <>
                  <p className="section-label !px-0 mt-4">Price Options</p>
                  <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Candidate prices">
                    {c.ladder.map((s) => {
                      const sel = price != null && Math.abs(price - s.price) < 0.005;
                      return (
                        <button key={s.price} type="button" aria-pressed={sel} onClick={() => set({ price: s.price.toFixed(2) })} className={cx("flex min-h-[64px] min-w-[96px] shrink-0 flex-col items-center justify-center rounded-xl px-3 py-1.5 active:opacity-70", s.meetsTarget ? "bg-good-soft text-good" : "bg-danger-soft text-danger", sel && "ring-2 ring-accent")}>
                          <span className="text-[11px] font-semibold uppercase leading-none tracking-wide">{s.isSuggested ? "Suggested" : s.meetsTarget ? " " : "Below"}</span>
                          <span className="mt-1 text-[17px] font-semibold leading-tight tnum">{money(s.price)}</span>
                          <span className="text-[13px] leading-tight tnum">GP {gp(s.gpPct, !s.meetsTarget && Math.round(s.gpPct * 100) >= Math.round(c.targetGp * 100) ? 1 : 0)}</span>
                          <span className="mt-0.5 text-[11px] leading-tight opacity-90 tnum">{priceBreakEvenLabel(simInput, s.price) || " "}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : null}

              <button type="button" className="btn-primary mt-4 w-full" disabled={!canSave || (!!offerId && !dirty)} onClick={() => void save()}>
                {busy ? "Saving…" : offerId ? (dirty ? "Save Changes" : "Saved") : "Save As Draft"}
              </button>
              {!canSave && !busy ? <p className="mt-1.5 text-center text-[13px] text-label-2">Add a name and at least one component to save.</p> : null}
            </section>
          </div>
        </div>

        <div className="lg:col-span-2 lg:row-start-3">
          <OfferSimulator cost={c} kind={d.kind} gstRate={store.settings.gst_rate} assumptions={d.assumptions} onChange={setAssumptions} unsaved={store.assumptionsUnsaved} />
        </div>

        <div className="lg:col-start-2 lg:row-start-2">
          <div>
            <p className="section-label !px-1 mt-6">Status</p>
            <Chips ariaLabel="Status" value={d.status} onChange={(s) => void changeStatus(s)} options={OFFER_STATUSES.map((s) => ({ value: s.value, label: s.label }))} />
            <p className="px-1 pt-1.5 text-[13px] text-label-2">
              {d.status === "live" ? "Live offers that slip below target show on Home." : d.status === "retired" ? "Retired offers are kept for reference and never flagged." : "Drafts are private workings. Set Live when it goes on the menu."}
              {!offerId && d.status !== "draft" ? " It takes effect when you save." : ""}
            </p>

            {offerId ? (
              <div className="group-list mt-6">
                <Row
                  title="Duplicate Offer"
                  sub="Copies the components into a new Draft"
                  onClick={() =>
                    store
                      .duplicateOffer(offerId)
                      .then((id) => router.push(`/specials/${id}`))
                      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                  }
                />
                {confirmDelete ? (
                  <div className="space-y-2 p-3">
                    <p className="px-1 text-center text-[15px] text-label-2">Delete {saved?.name ?? "this offer"}? Menu items and prices are not affected.</p>
                    <button
                      className="btn w-full bg-danger-soft text-danger"
                      onClick={() =>
                        store
                          .deleteOffer(offerId)
                          .then(() => router.push("/specials"))
                          .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                      }
                    >
                      Delete Offer
                    </button>
                    <button className="btn-plain w-full" onClick={() => setConfirmDelete(false)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <Row title={<span className="text-danger">Delete Offer…</span>} onClick={() => setConfirmDelete(true)} />
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <ComponentPicker open={picking} onClose={() => setPicking(false)} venueId={d.venueId} onPick={addLine} />
    </div>
  );
}
