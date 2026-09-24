"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Plus, Trash2, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { isVirtualItemId } from "@/lib/gelato";
import { gp, money } from "@/lib/format";
import { indexDoc, search } from "@/lib/search";
import { gpForPrice, parseGpInput, parsePriceInput, priceForGp } from "@/lib/solver";
import { MENU_CATEGORIES, type Special } from "@/lib/types";
import { useVenue, VenueChips, VENUE_SHORT } from "@/components/venue";
import { Banner, cx, Empty, FieldRow, InlineInput, Menu, PageHeader, SearchField } from "@/components/ui";

export default function SpecialsPage() {
  const store = useStore();
  const { venue } = useVenue();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    const list = venue ? store.specials.filter((s) => s.venue_id === venue.id || s.venue_id == null) : store.specials;
    return [...list].sort((a, b) => b.id - a.id);
  }, [store.specials, venue]);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await store.insertSpecial({ name: "New special", venue_id: venue?.id ?? store.venues[0]?.id ?? null, category: "Food", based_on_item: null, manual_cost: null, sell_price_inc: null, target_gp: null, notes: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Specials"
        subtitle="Quick pricing for a one-off dish."
        trailing={
          <button className="btn-tinted" onClick={() => void add()} disabled={busy}>
            <Plus className="h-4 w-4" strokeWidth={2.5} /> <span className="hidden sm:inline">New special</span>
          </button>
        }
      />
      <VenueChips />
      {error ? <Banner>{error}</Banner> : null}
      {rows.length === 0 ? (
        <Empty title="No specials" body="Price a special from an existing dish’s cost or a cost you type in." />
      ) : (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {rows.map((s) => (
            <SpecialCard key={s.id} s={s} onError={setError} />
          ))}
        </div>
      )}
    </div>
  );
}

function SpecialCard({ s, onError }: { s: Special; onError: (m: string | null) => void }) {
  const store = useStore();
  const gst = store.settings.gst_rate;
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  const base = s.based_on_item ? store.itemCosts.get(s.based_on_item) : undefined;
  const cost = base ? base.costPerPortion : Number(s.manual_cost) || 0;
  const defaultTarget = store.targets.find((t) => t.venue_id === s.venue_id && t.category === s.category)?.target_gp ?? 0.7;
  const target = s.target_gp != null ? Number(s.target_gp) : Number(defaultTarget);
  const gpPct = gpForPrice(cost, s.sell_price_inc, gst);
  const targetPrice = priceForGp(cost, target, gst, store.settings.round_to);
  const under = gpPct != null && gpPct < target - 1e-9;
  const venue = store.venueById.get(s.venue_id ?? -1);

  const patch = (p: Partial<Special>) => store.updateSpecial(s.id, p).catch((e) => onError(e instanceof Error ? e.message : String(e)));

  const docs = useMemo(
    () => [...store.itemCosts.values()].filter((c) => c.item.active && !isVirtualItemId(c.item.id) && (!s.venue_id || c.item.venue_id === s.venue_id)).map((c) => ({ ...indexDoc({ kind: "item" as const, id: c.item.id, title: c.item.name, sub: "", href: "" }), c })),
    [store.itemCosts, s.venue_id],
  );
  const hits = useMemo(() => (q.trim() ? search(docs, q, 6).map((h) => h.doc.c) : []), [docs, q]);

  return (
    <section className={cx(venue ? `v-${venue.slug}` : "", "rounded-2xl bg-surface")}>
      <div className="flex items-center gap-2 px-4 pt-3">
        <input
          className="min-w-0 flex-1 bg-transparent text-[20px] font-semibold outline-none"
          defaultValue={s.name}
          aria-label="Special name"
          onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && patch({ name: e.target.value.trim() })}
        />
        <button type="button" aria-label="Delete special" className="flex h-9 w-9 items-center justify-center rounded-full text-label-3 hover:text-danger" onClick={() => store.deleteSpecial(s.id).catch((e) => onError(String(e)))}>
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1 px-3 pb-2">
        <Menu
          label="Venue"
          align="left"
          trigger={
            <span className="inline-flex h-8 items-center gap-1 rounded-full bg-accent-soft px-3 text-[13px] font-semibold text-accent">
              {venue ? VENUE_SHORT[venue.slug] ?? venue.name : "Any venue"}
              <ChevronDown className="h-3.5 w-3.5" strokeWidth={2.5} />
            </span>
          }
          items={store.venues.map((v) => ({ label: v.name, checked: v.id === s.venue_id, onClick: () => void patch({ venue_id: v.id }) }))}
        />
        <Menu
          label="Category"
          align="left"
          trigger={
            <span className="inline-flex h-8 items-center gap-1 rounded-full bg-fill px-3 text-[13px] font-medium text-label">
              {s.category ?? "No category"}
              <ChevronDown className="h-3.5 w-3.5 text-label-2" strokeWidth={2.5} />
            </span>
          }
          items={MENU_CATEGORIES.map((c) => ({ label: c, checked: c === s.category, onClick: () => void patch({ category: c }) }))}
        />
      </div>

      <div className="group-list !rounded-none">
        {base && !picking ? (
          <FieldRow label="Cost" sub={`From ${base.item.name}`}>
            <span className="flex items-center gap-1 text-[17px] tnum sm:text-[15px]">
              {money(cost)}
              <button type="button" aria-label="Clear base item" className="flex h-8 w-8 items-center justify-center text-label-3" onClick={() => patch({ based_on_item: null })}>
                <X className="h-4 w-4" />
              </button>
            </span>
          </FieldRow>
        ) : (
          <FieldRow
            label="Cost"
            sub={
              <button type="button" className="text-accent" onClick={() => setPicking((p) => !p)}>
                {picking ? "Type a cost instead" : "Use a dish’s cost…"}
              </button>
            }
          >
            <InlineInput value={s.manual_cost != null ? String(s.manual_cost) : ""} placeholder="0.00" prefix="$" onCommit={(t) => patch({ manual_cost: parsePriceInput(t) })} />
          </FieldRow>
        )}
        {picking ? (
          <div className="px-4 py-2">
            <SearchField autoFocus value={q} onChange={setQ} placeholder="Search dishes" />
            {hits.map((c) => (
              <button
                key={c.item.id}
                type="button"
                className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left text-[15px]"
                onClick={() => {
                  void patch({ based_on_item: c.item.id, category: s.category ?? c.item.category });
                  setPicking(false);
                  setQ("");
                }}
              >
                <span className="truncate">{c.item.name}</span>
                <span className="text-label-2 tnum">{money(c.costPerPortion)}</span>
              </button>
            ))}
          </div>
        ) : null}
        <FieldRow label="Sell price" sub="inc GST">
          <InlineInput value={s.sell_price_inc != null ? String(s.sell_price_inc) : ""} placeholder="0.00" prefix="$" onCommit={(t) => patch({ sell_price_inc: parsePriceInput(t) })} />
        </FieldRow>
        <FieldRow label="GP">
          <span className={cx("text-[20px] font-semibold tnum", under ? "text-danger" : "text-label")}>{gp(gpPct)}</span>
        </FieldRow>
        <FieldRow label="Target GP" sub={s.target_gp == null ? `Default ${gp(Number(defaultTarget), 0)}` : undefined}>
          <InlineInput value={s.target_gp != null ? String(Math.round(Number(s.target_gp) * 1000) / 10) : ""} placeholder={String(Math.round(Number(defaultTarget) * 100))} suffix="%" onCommit={(t) => patch({ target_gp: t.trim() ? parseGpInput(t) : null })} />
        </FieldRow>
      </div>
      {cost > 0 && targetPrice != null && s.sell_price_inc !== targetPrice ? (
        <div className="px-4 py-3">
          <button type="button" className={cx("inline-flex min-h-[32px] items-center rounded-full px-3 text-[13px] font-semibold", under ? "bg-danger-soft text-danger" : "bg-fill text-label")} onClick={() => patch({ sell_price_inc: targetPrice })}>
            Use {money(targetPrice)} for {gp(target, 0)} target
          </button>
        </div>
      ) : (
        <div className="h-3" />
      )}
    </section>
  );
}
