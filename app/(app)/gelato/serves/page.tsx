"use client";

import { RecordHistory } from "@/components/editor/record-history";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronLeft, Plus, Trash2 } from "lucide-react";
import { newId, useStore } from "@/lib/store";
import { costLines } from "@/lib/costing";
import { packagingLines } from "@/lib/gelato";
import { gp, money, parseDecimal, unitShort } from "@/lib/format";
import { parseGpInput, parsePercentInput } from "@/lib/solver";
import type { GelatoServe, GelatoServeLine } from "@/lib/types";
import { PriceHistory } from "@/components/editor/price-history";
import { SmartAdd } from "@/components/editor/smart-add";
import { ActiveToggle, DeleteRecordSheet, ShowInactiveButton, TitleWithTag } from "@/components/active-parts";
import { countInactive, visibleRecords } from "@/lib/active";
import type { RecordImpact } from "@/lib/record-usage";
import { Banner, FieldRow, Group, InlineInput, PageHeader, Row, Sheet, Toggle, useToast } from "@/components/ui";

export default function GelatoServesPage() {
  const store = useStore();
  const venue = store.gelato.venue;
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const serves = useMemo(
    () => (venue ? store.gelatoServes.filter((s) => s.venue_id === venue.id).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)) : []),
    [store.gelatoServes, venue],
  );
  const inactiveCount = useMemo(() => countInactive(serves), [serves]);
  const shown = useMemo(() => visibleRecords(serves, showInactive), [serves, showInactive]);
  const packCost = (serveId: string) => costLines(packagingLines(serveId, store.gelatoServeLines), store.index, store.settings.gst_rate).total;

  const run = (p: Promise<void>) => {
    setError(null);
    p.catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  const pctIn = (v: number) => String(Math.round(v * 1000) / 10);

  if (!venue) return <PageHeader title="Serves" subtitle="There’s no Gelato Rumba venue in the system." />;

  return (
    <div className="max-w-2xl">
      <div className="pt-2 lg:pt-6">
        <Link href="/menu?venue=gelato" className="btn-text -ml-1 !gap-0 !text-accent">
          <ChevronLeft className="h-6 w-6" strokeWidth={2.25} />
          Menu
        </Link>
      </div>
      <PageHeader title="Serves" subtitle="Grams, price and packaging for every way a flavour is sold" className="!pt-1" />
      {error ? <Banner>{error}</Banner> : null}

      <Group footer="Extra gelato allowed for per serve — scooping, display tray leftovers and melt. It’s added to every serve’s gelato cost.">
        <FieldRow label="Wastage Allowance">
          <InlineInput
            value={pctIn(store.settings.gelato_wastage)}
            suffix="%"
            onCommit={(t) => {
              const n = parsePercentInput(t);
              if (t.trim() && n != null && n < 1) run(store.updateSetting("gelato_wastage", n));
            }}
          />
        </FieldRow>
      </Group>

      <Group
        title="Serves"
        trailing={<ShowInactiveButton count={inactiveCount} show={showInactive} onToggle={() => setShowInactive((x) => !x)} />}
        footer="Serves marked “on menu” are the default view on the Price Grid. Every active serve counts towards the Gelato Rumba GP."
      >
        {shown.map((s) => (
          <Row
            key={s.id}
            onClick={() => setEditing(s.id)}
            title={
              <>
                <TitleWithTag name={s.name} active={s.active} />
                {s.active && !s.on_menu ? <span className="ml-1.5 text-[13px] text-label-3">not on menu</span> : null}
              </>
            }
            sub={`${Number(s.grams)}g gelato · packaging ${money(packCost(s.id))}${s.notes ? ` · ${s.notes}` : ""}`}
            trailing={<span className="text-label">{s.sell_price_inc != null ? money(Number(s.sell_price_inc)) : "No price"}</span>}
            chevron
          />
        ))}
        <Row onClick={() => setEditing("new")} leading={<Plus className="h-5 w-5 text-accent" strokeWidth={2.5} />} title={<span className="text-accent">Add Serve</span>} />
      </Group>

      {editing ? (
        <ServeSheet
          key={editing}
          serve={editing === "new" ? null : serves.find((s) => s.id === editing) ?? null}
          venueId={venue.id}
          nextSort={(serves[serves.length - 1]?.sort ?? 0) + 1}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function ServeSheet({ serve, venueId, nextSort, onClose }: { serve: GelatoServe | null; venueId: number; nextSort: number; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState<Omit<GelatoServe, "id">>(
    serve ?? { venue_id: venueId, name: "", sort: nextSort, grams: 100, sell_price_inc: null, on_menu: false, active: true, notes: null },
  );
  const [lines, setLines] = useState<GelatoServeLine[]>(() => (serve ? store.gelatoServeLines.filter((l) => l.serve_id === serve.id).sort((a, b) => a.sort - b.sort) : []));
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeFlavours = store.gelato.flavours.filter((f) => f.active).length;
  // saved serves only: every flavour is sold in every active serve, so switching one off or deleting it touches all of them
  const impact: RecordImpact = {
    refs: [],
    notes: serve && activeFlavours > 0 ? [`Every flavour (${activeFlavours}) loses this serve: it leaves the Price Grid, the averages and the alerts. Its prices stay saved.`] : [],
  };

  const costed = useMemo(
    () => costLines(lines.map((l) => ({ id: l.id, parent_type: "item", parent_id: "x", component_type: "ingredient", component_id: l.ingredient_id, qty: l.qty, unit: l.unit, note: null, sort: l.sort })), store.index, store.settings.gst_rate),
    [lines, store.index, store.settings.gst_rate],
  );
  const canSave = draft.name.trim().length > 0 && Number(draft.grams) > 0 && !busy;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const clean = { ...draft, name: draft.name.trim(), grams: Number(draft.grams) };
      let id = serve?.id;
      if (id) await store.updateServe(id, clean);
      else id = await store.insertServe(clean);
      await store.saveServeLines(id, lines.map((l) => ({ ...l, serve_id: id! })));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const num = parseDecimal;

  return (
    <Sheet open onClose={onClose} title={serve ? serve.name : "New Serve"} action={{ label: busy ? "Saving…" : "Save", onClick: () => void save(), disabled: !canSave }}>
      <div className="pb-2 pt-3">
        {error ? <Banner>{error}</Banner> : null}
        <div className="group-list">
          <FieldRow label="Name">
            <InlineInput value={draft.name} placeholder="e.g. 2 scoop cup" inputMode="text" width="w-44" onCommit={(t) => setDraft((d) => ({ ...d, name: t }))} />
          </FieldRow>
          <FieldRow label="Gelato" sub={`Costed at ${Math.round(Number(draft.grams) * (1 + store.settings.gelato_wastage))}g with ${gp(store.settings.gelato_wastage, 0)} wastage`}>
            <InlineInput value={String(draft.grams)} suffix="g" onCommit={(t) => { const n = num(t); if (n && n > 0) setDraft((d) => ({ ...d, grams: n })); }} />
          </FieldRow>
          <FieldRow label="Target GP" sub={`Blank uses the Gelato target. Tubs and wholesale usually sit lower.`}>
            <InlineInput
              value={draft.target_gp != null ? String(Math.round(Number(draft.target_gp) * 1000) / 10) : ""}
              placeholder="Default"
              suffix="%"
              onCommit={(t) => {
                const n = parseGpInput(t);
                if (t.trim() === "") setDraft((d) => ({ ...d, target_gp: null }));
                else if (n != null) setDraft((d) => ({ ...d, target_gp: n }));
              }}
            />
          </FieldRow>
          <FieldRow label="Price (inc GST)" sub="Same for every flavour">
            <InlineInput value={draft.sell_price_inc != null ? Number(draft.sell_price_inc).toFixed(2) : ""} placeholder="None" prefix="$" onCommit={(t) => {
              const n = num(t);
              if (t.trim() === "") setDraft((d) => ({ ...d, sell_price_inc: null }));
              else if (n != null) setDraft((d) => ({ ...d, sell_price_inc: n }));
            }} />
          </FieldRow>
        </div>
        <div className="group-list mt-4">
          <Toggle label="On the Menu" sub="Shown in the default Gelato view" checked={draft.on_menu} onChange={(v) => setDraft((d) => ({ ...d, on_menu: v }))} />
          <ActiveToggle checked={draft.active} record="serve" name={draft.name || "this serve"} impact={impact} onChange={(v) => setDraft((d) => ({ ...d, active: v }))} />
        </div>

        <Group title="Packaging" trailing={<span className="text-[13px] text-label-2 tnum">{money(costed.total)}</span>} footer="Cup or cone, spoon, napkin, sleeve, choc dip — anything that goes with every serve regardless of flavour.">
          {costed.lines.map((lc, i) => (
            <div key={lc.line.id} className="flex min-h-[48px] items-center gap-2 px-4 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[17px] sm:text-[15px]">{lc.componentName}</span>
                {lc.warning ? <span className="block text-[13px] text-warn">⚠ Costed {lc.componentBase === "each" ? "each" : `per ${lc.componentBase}`} — change the unit</span> : null}
              </span>
                <InlineInput
                  value={String(lines[i].qty)}
                  suffix={unitShort(lines[i].unit)}
                  width="w-20"
                  onCommit={(t) => {
                    const n = num(t);
                    if (n != null && n >= 0) setLines((ls) => ls.map((l, k) => (k === i ? { ...l, qty: n } : l)));
                  }}
                />
              <span className="w-14 text-right text-[15px] tnum text-label-2">{money(lc.cost)}</span>
              <button type="button" aria-label={`Remove ${lc.componentName}`} className="p-1 text-label-3 hover:text-danger" onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <SmartAdd
            placeholder="Add packaging — e.g. 1 Cup 8oz"
            onAdd={(a) => {
              if (a.component_type !== "ingredient") {
                toast.show({ message: "Packaging has to be an ingredient, not a prep" });
                return;
              }
              setLines((ls) => [...ls, { id: newId(), serve_id: serve?.id ?? "", ingredient_id: a.component_id, qty: a.qty ?? 1, unit: a.unit, sort: ls.length + 1 }]);
            }}
          />
        </Group>

        {serve ? <PriceHistory filter={{ kind: "gelato_serve", serveId: serve.id, limit: 10 }} refreshKey={serve.sell_price_inc} /> : null}

        {serve ? <RecordHistory table="cost_gelato_serves" rowKey={serve.id} label="serve" refreshKey={`${JSON.stringify([serve.name, serve.grams, serve.sell_price_inc, serve.on_menu, serve.active, serve.notes])}|${lines.length}`} /> : null}

        {serve ? (
          <div className="mt-6">
            <button className="btn-plain w-full text-danger" onClick={() => setDeleting(true)}>
              Delete Serve…
            </button>
            <p className="px-1 pt-1.5 text-center text-[13px] text-label-2">You see what it affects first. Making it inactive is usually better.</p>
          </div>
        ) : null}
        {serve && deleting ? (
          <DeleteRecordSheet
            record="serve"
            name={serve.name}
            impact={impact}
            alreadyInactive={!serve.active}
            onClose={() => setDeleting(false)}
            onMakeInactive={async () => {
              await store.updateServe(serve.id, { active: false });
              toast.show({ message: `${serve.name} is now inactive`, action: { label: "Undo", onClick: () => void store.updateServe(serve.id, { active: true }) } });
              onClose();
            }}
            onDelete={async () => {
              await store.deleteServe(serve.id);
              setDeleting(false);
              onClose();
            }}
          />
        ) : null}
      </div>
    </Sheet>
  );
}
