"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronLeft, Plus, Trash2 } from "lucide-react";
import { newId, useStore } from "@/lib/store";
import { costLines } from "@/lib/costing";
import { packagingLines } from "@/lib/gelato";
import { gp, money, unitShort } from "@/lib/format";
import type { GelatoServe, GelatoServeLine } from "@/lib/types";
import { SmartAdd } from "@/components/editor/smart-add";
import { Banner, FieldRow, Group, InlineInput, PageHeader, Row, Sheet, Toggle, useToast } from "@/components/ui";

export default function GelatoServesPage() {
  const store = useStore();
  const venue = store.gelato.venue;
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);

  const serves = useMemo(
    () => (venue ? store.gelatoServes.filter((s) => s.venue_id === venue.id).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)) : []),
    [store.gelatoServes, venue],
  );
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
        <Link href="/gelato" className="btn-text -ml-1 !gap-0 !text-accent">
          <ChevronLeft className="h-6 w-6" strokeWidth={2.25} />
          Gelato
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
              const n = Number(t.replace(/[%\s]/g, ""));
              if (t.trim() && Number.isFinite(n) && n >= 0 && n < 100) run(store.updateSetting("gelato_wastage", n / 100));
            }}
          />
        </FieldRow>
      </Group>

      <Group title="Serves" footer="Serves marked “on menu” are the default view on the Gelato screen. Every serve counts towards the Gelato Rumba GP.">
        {serves.map((s) => (
          <Row
            key={s.id}
            onClick={() => setEditing(s.id)}
            title={
              <>
                {s.name}
                {!s.active ? <span className="ml-1.5 text-[13px] text-label-3">off</span> : !s.on_menu ? <span className="ml-1.5 text-[13px] text-label-3">not on menu</span> : null}
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function del() {
    if (!serve) return;
    setBusy(true);
    try {
      await store.deleteServe(serve.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const num = (t: string) => {
    const n = Number(t.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  };

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
                const n = num(t.replace("%", ""));
                setDraft((d) => ({ ...d, target_gp: t.trim() === "" || n == null ? null : n >= 1 ? n / 100 : n }));
              }}
            />
          </FieldRow>
          <FieldRow label="Price (inc GST)" sub="Same for every flavour">
            <InlineInput value={draft.sell_price_inc != null ? Number(draft.sell_price_inc).toFixed(2) : ""} placeholder="None" prefix="$" onCommit={(t) => setDraft((d) => ({ ...d, sell_price_inc: t.trim() ? num(t) : null }))} />
          </FieldRow>
        </div>
        <div className="group-list mt-4">
          <Toggle label="On the Menu" sub="Shown in the default Gelato view" checked={draft.on_menu} onChange={(v) => setDraft((d) => ({ ...d, on_menu: v }))} />
          <Toggle label="Active" sub="Off hides this serve everywhere" checked={draft.active} onChange={(v) => setDraft((d) => ({ ...d, active: v }))} />
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

        {serve ? (
          <div className="mt-6">
            {confirmDelete ? (
              <div className="space-y-2">
                <p className="px-1 text-center text-[15px] text-label-2">Delete {serve.name}? Every flavour loses this serve.</p>
                <button className="btn w-full bg-danger-soft text-danger" disabled={busy} onClick={() => void del()}>
                  Delete Serve
                </button>
                <button className="btn-plain w-full" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button className="btn-plain w-full text-danger" onClick={() => setConfirmDelete(true)}>
                Delete Serve…
              </button>
            )}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
