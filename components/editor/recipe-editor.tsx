"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Ellipsis, FlaskConical, GripVertical } from "lucide-react";
import { newId, useStore } from "@/lib/store";
import { costItem, costLines, parentKey, type LineCost, type PrepCost } from "@/lib/costing";
import { gp, money, parseDecimal, unitShort } from "@/lib/format";
import { formatQty } from "@/lib/parse-qty";
import { gpForPrice, parseGpInput, parsePriceInput } from "@/lib/solver";
import { addRecent } from "@/lib/recents";
import { batchWeightKg, flavourName, isGelatoFlavour } from "@/lib/gelato";
import { MENU_CATEGORIES, PACK_UNITS, type MenuItem, type PackUnit, type Prep, type RecipeLine } from "@/lib/types";
import { VenueAccent, VENUE_SHORT } from "../venue";
import { Banner, Chips, cx, Disclosure, Dot, Empty, FieldRow, Group, InlineInput, Menu, Row, Segmented, Sheet, Stepper, useToast } from "../ui";
import { LineEditor, type LinePatch } from "./line-editor";
import { PrepBadge, SmartAdd, type AddSpec } from "./smart-add";
import { PricePicker } from "./price-picker";
import { CheckCostBanner, HappyHourNote, ItemSummaryBar, ItemSummaryCard, PrepSummary } from "./summary";
import { GelatoFlavourPanel } from "./gelato-panel";
import { PriceHistory } from "./price-history";
import { CostBar, FixCard, trimFix } from "./cost-insight";
import { WhatIfSheet } from "./what-if";
import { RecipeAllergens } from "../allergen-picker";
import { DietOptionsGroup } from "./diet-options";
import { isBarCategory } from "@/lib/bar";
import { BarDisplayFields } from "./bar-fields";
import { KitchenDisplayFields } from "./kitchen-fields";
import { methodField, RecordResearchNotes, type RecipeTarget } from "./research-notes";
import { ServesCountInput, ServesSegmented } from "../serves-choice";
import { portionsForMode, servesMode, switchToOneNote, type ServesMode } from "@/lib/serves";
import { describeChanges, patchOf } from "@/lib/draft-changes";
import { useGuardedRouter, useUnsavedGuard } from "../unsaved-guard";
import { DiscardSheet, SaveBar, type SaveState } from "../save-bar";

type Kind = "item" | "prep";
type Rec = MenuItem | Prep;
type SaveStatus = "idle" | "saving" | "error";

function useIsDesktop() {
  const [d, setD] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setD(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return d;
}

function friendlyWarning(lc: LineCost | undefined, adjusted: boolean): string | null {
  if (!lc) return null;
  const base = lc.componentBase ? (lc.componentBase === "each" ? "each" : `per ${lc.componentBase}`) : "";
  switch (lc.warning?.kind) {
    case "missing_component":
      return "This ingredient no longer exists — swap it.";
    case "cycle":
      return "This prep ends up using itself.";
    case "depth":
      return "Preps are nested too deeply to cost.";
    case "unit_mismatch":
      return `${lc.componentName} is costed ${base} — change the unit.`;
  }
  if (adjusted) return `Set to ${unitShort(lc.line.unit)} — ${lc.componentName} is bought ${base}. Check the quantity.`;
  if (!lc.unitCost) return `No price for ${lc.componentName} yet.`;
  return null;
}

export function RecipeEditorPage({ kind, id }: { kind: Kind; id: string }) {
  const store = useStore();
  const rec: Rec | undefined = kind === "item" ? store.items.find((i) => i.id === id) : store.preps.find((p) => p.id === id);
  if (!rec)
    return (
      <Empty
        title={kind === "item" ? "Recipe not found" : "Prep not found"}
        body="It may have been deleted."
        action={
          <Link href={kind === "item" ? "/menu" : "/ingredients?type=preps"} className="btn-primary">
            {kind === "item" ? "Back to Menu" : "Back to Preps"}
          </Link>
        }
      />
    );
  return <RecipeEditor key={id} kind={kind} saved={rec} />;
}

function RecipeEditor({ kind, saved }: { kind: Kind; saved: Rec }) {
  const store = useStore();
  const storeRef = useRef(store);
  storeRef.current = store;
  const router = useGuardedRouter();
  const params = useSearchParams();
  const toast = useToast();
  const desktop = useIsDesktop();
  const id = saved.id;
  const isNew = params.get("new") === "1";

  const savedLines = useMemo(() => store.index.linesByParent.get(parentKey(kind, id)) ?? [], [store.index, kind, id]);

  const [draft, setDraftState] = useState<Rec>(saved);
  const [lines, setLinesState] = useState<RecipeLine[]>(savedLines);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [saveErrorText, setSaveErrorText] = useState<string | null>(null);
  const [openLine, setOpenLine] = useState<string | null>(null);
  const [focusQtyFor, setFocusQtyFor] = useState<string | null>(null);
  const [adjusted, setAdjusted] = useState<Set<string>>(new Set());
  const [addFocused, setAddFocused] = useState(false);
  const [sheet, setSheet] = useState<null | "venue" | "category" | "duplicate" | "delete" | "usedin" | "whatif" | "discard">(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [focusServes, setFocusServes] = useState(false);

  // ---------- manual save (refs hold the latest values; Save writes only what changed since the last save) ----------
  const draftRef = useRef(draft);
  const linesRef = useRef(lines);
  const [base, setBaseState] = useState<{ draft: Rec; lines: RecipeLine[] }>({ draft: saved, lines: savedLines });
  const baseRef = useRef(base);
  const setBase = (b: { draft: Rec; lines: RecipeLine[] }) => {
    baseRef.current = b;
    setBaseState(b);
  };
  const saving = useRef(false);
  const saveError = useRef<string | null>(null);
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));

  const changes = useMemo(() => describeChanges(base.draft, draft, base.lines, lines), [base, draft, lines]);
  const dirty = changes.dirty;

  const runSave = useCallback(async (): Promise<boolean> => {
    saving.current = true;
    try {
      const b = baseRef.current;
      let d = draftRef.current;
      if (!d.name.trim()) d = { ...d, name: b.draft.name || "Untitled" };
      const ls = linesRef.current.filter((l) => l.component_id);
      const c = describeChanges(b.draft, d, b.lines, ls);
      if (!c.dirty) {
        setStatus("idle");
        return true;
      }
      setStatus("saving");
      const s = storeRef.current;
      const patch = patchOf(b.draft, d);
      if (Object.keys(patch).length) {
        if (kind === "item") await s.updateItem(id, patch as Partial<MenuItem>);
        else await s.updatePrep(id, patch as Partial<Prep>);
      }
      const l = c.lines;
      if (l.added || l.removed || l.edited || l.reordered) await s.saveLines(kind, id, ls);
      setBase({ draft: d, lines: ls });
      if (d !== draftRef.current) {
        draftRef.current = d;
        setDraftState(d);
      }
      saveError.current = null;
      setSaveErrorText(null);
      setStatus("idle");
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      saveError.current = msg;
      setSaveErrorText(msg);
      setStatus("error");
      return false;
    } finally {
      saving.current = false;
    }
  }, [kind, id]);

  /** Saves everything pending. Saves queue up, so a second request waits for the first. Resolves true only when saved. */
  const save = useCallback((): Promise<boolean> => {
    const next = queue.current.then(runSave, runSave);
    queue.current = next;
    return next;
  }, [runSave]);

  /** Puts the draft back to the last saved version. */
  const discard = () => {
    const b = baseRef.current;
    draftRef.current = b.draft;
    linesRef.current = b.lines;
    setDraftState(b.draft);
    setLinesState(b.lines);
    setAdjusted(new Set());
    setOpenLine(null);
    saveError.current = null;
    setSaveErrorText(null);
    setStatus("idle");
    setSheet(null);
    toast.show({ message: "Changes discarded" });
  };

  const setDraft = useCallback((fn: (d: Rec) => Rec) => {
    const n = fn(draftRef.current);
    draftRef.current = n;
    setDraftState(n);
  }, []);
  // gelato flavour mixes: the batch yield is always the mix's total weight
  const gelatoVenueId = store.gelato.venue?.id;
  const isFlavour = kind === "prep" && isGelatoFlavour(draft as Prep, gelatoVenueId);
  const isFlavourRef = useRef(isFlavour);
  isFlavourRef.current = isFlavour;
  const setLines = useCallback(
    (fn: (l: RecipeLine[]) => RecipeLine[]) => {
      const n = fn(linesRef.current);
      linesRef.current = n;
      setLinesState(n);
      if (isFlavourRef.current) {
        const kg = batchWeightKg(n.filter((l) => l.component_id));
        const d = draftRef.current as Prep;
        if (kg > 0 && (Number(d.yield_qty) !== kg || d.yield_unit !== "kg")) {
          const nd = { ...d, yield_qty: kg, yield_unit: "kg" as PackUnit };
          draftRef.current = nd;
          setDraftState(nd);
        }
      }
    },
    [],
  );

  // Research notes: Approve writes through this draft, then saves everything pending (an explicit confirmation) and resolves once it is saved
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const commitNow = save;
  const noteTarget = useMemo<RecipeTarget | undefined>(
    () =>
      kind === "item"
        ? {
            getLines: () => linesRef.current,
            getMethod: () => {
              const m = (draftRef.current as MenuItem)[methodField(draftRef.current as MenuItem)];
              return Array.isArray(m) ? m.map(String) : [];
            },
            write: async ({ lines, method }) => {
              if (lines) setLines(() => lines);
              if (method) {
                const field = methodField(draftRef.current as MenuItem);
                setDraft((d) => ({ ...d, [field]: method }) as Rec);
              }
              if (!(await commitNow())) throw new Error("Not saved");
            },
            alive: () => mounted.current,
          }
        : undefined,
    [kind, setLines, setDraft, commitNow],
  );

  // adopt store changes (background refresh) when there are no local edits
  useEffect(() => {
    if (saving.current) return;
    const b = baseRef.current;
    if (describeChanges(b.draft, draftRef.current, b.lines, linesRef.current).dirty) return;
    draftRef.current = saved;
    linesRef.current = savedLines;
    setBase({ draft: saved, lines: savedLines });
    setDraftState(saved);
    setLinesState(savedLines);
  }, [saved, savedLines]);

  // leave guard: link clicks, Back, tab close and reload ask first while there are unsaved edits
  const { release } = useUnsavedGuard(dirty, { save, getError: () => saveError.current });

  // recents
  useEffect(() => {
    const v = store.venueById.get((saved as MenuItem).venue_id ?? -1);
    addRecent({ kind, id, title: saved.name, sub: kind === "item" ? `${VENUE_SHORT[v?.slug ?? ""] ?? ""} · ${(saved as MenuItem).category}` : "Prep", href: `/${kind === "item" ? "items" : "preps"}/${id}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ---------- costing ----------
  const itemCost = useMemo(() => (kind === "item" ? costItem(draft as MenuItem, store.index, store.settings, store.targets, new Map<string, PrepCost>(), lines) : null), [kind, draft, lines, store.index, store.settings, store.targets]);
  const prepRecipe = useMemo(() => (kind === "prep" ? costLines(lines, store.index, store.settings.gst_rate, [id]) : null), [kind, lines, store.index, store.settings.gst_rate, id]);
  const recipe = itemCost?.recipe ?? prepRecipe!;
  const costById = useMemo(() => new Map(recipe.lines.map((c) => [c.line.id, c])), [recipe]);
  const prep = kind === "prep" ? (draft as Prep) : null;
  const item = kind === "item" ? (draft as MenuItem) : null;
  const prepYield = prep ? Number(prep.yield_qty) || 0 : 0;
  const prepCostPerUnit = prep && prepYield > 0 ? recipe.total / prepYield : 0;
  const venue = store.venueById.get((draft as MenuItem).venue_id ?? -1);
  const usedIn = useMemo(() => (kind === "prep" ? store.usedIn("prep", id) : { items: [], preps: [] }), [kind, store, id]);

  // ---------- serves: One Serve | Multiple Serves ----------
  const switchServes = (mode: ServesMode) => {
    if (!item || mode === servesMode(item.portions)) return;
    const before = item.portions;
    setDraft((d) => ({ ...d, portions: portionsForMode(mode, before) }));
    setFocusServes(mode === "multiple");
    if (mode === "one") {
      const note = itemCost ? switchToOneNote(itemCost.recipeCost, before) : null;
      if (note) toast.show({ message: note, action: { label: "Undo", onClick: () => setDraft((d) => ({ ...d, portions: before })) } });
    }
  };

  // ---------- line ops ----------
  const addLine = (s: AddSpec) => {
    const lid = newId();
    const line: RecipeLine = { id: lid, parent_type: kind, parent_id: id, component_type: s.component_type, component_id: s.component_id, qty: s.qty ?? 0, unit: s.unit, note: null, sort: linesRef.current.length + 1 };
    setLines((ls) => [...ls, line]);
    if (s.adjusted) setAdjusted((a) => new Set(a).add(lid));
    if (s.qty == null) {
      setFocusQtyFor(lid);
      setOpenLine(lid);
    }
  };
  const patchLine = (lid: string, p: LinePatch) => {
    setLines((ls) => ls.map((l) => (l.id === lid ? { ...l, ...p } : l)));
    if (p.unit || p.qty != null || p.component_id) setAdjusted((a) => (a.has(lid) ? new Set([...a].filter((x) => x !== lid)) : a));
  };
  const moveLine = (lid: string, dir: -1 | 1) =>
    setLines((ls) => {
      const i = ls.findIndex((l) => l.id === lid);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ls.length) return ls;
      const next = [...ls];
      [next[i], next[j]] = [next[j], next[i]];
      return next.map((l, k) => ({ ...l, sort: k + 1 }));
    });
  const removeLine = (lid: string) => {
    const idx = linesRef.current.findIndex((l) => l.id === lid);
    const line = linesRef.current[idx];
    if (!line) return;
    const name = costById.get(lid)?.componentName ?? "line";
    setOpenLine(null);
    setLines((ls) => ls.filter((l) => l.id !== lid));
    toast.show({
      message: `Removed ${name}`,
      action: {
        label: "Undo",
        onClick: () =>
          setLines((ls) => {
            const next = [...ls];
            next.splice(Math.min(idx, next.length), 0, line);
            return next;
          }),
      },
    });
  };
  const dropOn = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    setLines((ls) => {
      const from = ls.findIndex((l) => l.id === dragId);
      const to = ls.findIndex((l) => l.id === targetId);
      if (from < 0 || to < 0) return ls;
      const next = [...ls];
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return next.map((l, k) => ({ ...l, sort: k + 1 }));
    });
  };

  // ---------- title ----------
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft.name, desktop]);

  const saveState: SaveState = status === "saving" ? "saving" : status === "error" && dirty ? "error" : dirty ? "dirty" : "saved";
  const openLineObj = openLine ? lines.find((l) => l.id === openLine) ?? null : null;
  const backHref = isFlavour ? "/menu?venue=gelato" : kind === "item" ? `/menu${venue ? `?venue=${venue.slug}` : ""}` : `/ingredients?type=preps${venue ? `&venue=${venue.slug}` : ""}`;

  const phoneSaveBar = <SaveBar state={saveState} onSave={() => void save()} onDiscard={() => setSheet("discard")} className="px-4 pb-1 pt-2" />;

  const fix = itemCost ? trimFix(itemCost, recipe.lines, store.settings.gst_rate) : null;
  const menuItems = [
    ...(kind === "item" ? [{ label: "What If…", onClick: () => setSheet("whatif") }] : []),
    { label: "Duplicate to Venue…", onClick: () => setSheet("duplicate") },
    { label: draft.active ? "Make Inactive" : "Make Active", onClick: () => setDraft((d) => ({ ...d, active: !d.active })) },
    ...(kind === "prep" ? [{ label: `Used In (${usedIn.items.length + usedIn.preps.length})`, onClick: () => setSheet("usedin") }] : []),
    "sep" as const,
    { label: "Delete…", destructive: true, onClick: () => setSheet("delete") },
  ];

  return (
    <div className="lg:pt-6">
      <VenueAccent slug={venue?.slug} />
      {/* nav bar */}
      <div className="bar-blur sticky top-0 z-30 -mx-4 flex h-11 items-center justify-between px-2 sm:-mx-6 lg:static lg:mx-0 lg:bg-transparent lg:px-0 lg:backdrop-blur-none">
        <Link href={backHref} className="btn-text -ml-1 !gap-0 !text-accent">
          <ChevronLeft className="h-6 w-6" strokeWidth={2.25} />
          {isFlavour || kind === "item" ? "Menu" : "Ingredients · Preps"}
        </Link>
        <div className="flex items-center gap-1">
          <Menu label="More Actions" trigger={<Ellipsis className="h-6 w-6" strokeWidth={2} />} items={menuItems} />
        </div>
      </div>

      {saveState === "error" ? (
        <Banner
          action={
            <button className="shrink-0 font-semibold" onClick={() => void save()}>
              Retry
            </button>
          }
        >
          Couldn’t save your changes{saveErrorText ? ` — ${saveErrorText}` : ""}. Your edits are still here.
        </Banner>
      ) : null}

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-8">
        <div className="min-w-0">
          {/* title + meta */}
          <textarea
            ref={titleRef}
            rows={1}
            value={draft.name}
            placeholder="Recipe name"
            aria-label="Recipe Name"
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value.replace(/\n/g, " ") }))}
            onBlur={() => {
              if (!draftRef.current.name.trim()) setDraft((d) => ({ ...d, name: saved.name || "Untitled" }));
            }}
            className="mt-2 block w-full resize-none overflow-hidden bg-transparent text-[28px] font-bold leading-tight tracking-tight outline-none placeholder:text-label-3 lg:text-[32px]"
          />
          {!draft.active ? <p className="mt-1 text-[13px] font-medium text-label-2">Inactive — hidden from averages</p> : null}
          <p className="mt-1 text-[15px] text-label-2">
            {[venue ? venue.name : "Shared prep", item ? item.category : isFlavour ? "Gelato flavour" : "Prep"].join(" · ")}
          </p>

          <div className="group-list mt-5">
            <Row onClick={() => setSheet("venue")} title="Venue" trailing={<span className="text-label-2">{venue ? VENUE_SHORT[venue.slug] ?? venue.name : "Shared"}</span>} chevron />
            {item ? <Row onClick={() => setSheet("category")} title="Category" trailing={<span className="text-label-2">{item.category}</span>} chevron /> : null}
            {item ? (
              <>
                <FieldRow label="Serves">
                  <ServesSegmented value={servesMode(item.portions)} onChange={switchServes} size="md" className="w-[250px] sm:w-[240px]" />
                </FieldRow>
                {servesMode(item.portions) === "multiple" ? (
                  <FieldRow label="Serves From This Recipe" sub={`${money(itemCost?.recipeCost)} recipe, ${money(itemCost ? itemCost.costPerPortion : null)} a serve`}>
                    <ServesCountInput portions={Number(item.portions)} autoFocus={focusServes} onChange={(n) => setDraft((d) => ({ ...d, portions: n }))} />
                  </FieldRow>
                ) : null}
              </>
            ) : prep && isFlavour ? (
              <FieldRow label="Batch Weight" sub="Total of the mix ingredients — updates as you edit">
                <span className="text-[17px] tnum text-label-2 sm:text-[15px]">{formatQty(batchWeightKg(lines.filter((l) => l.component_id)), "kg")}</span>
              </FieldRow>
            ) : prep ? (
              <FieldRow label="Batch Yield">
                <span className="flex items-center gap-2">
                  <InlineInput value={String(prep.yield_qty)} width="w-20" onCommit={(t) => { const n = parseDecimal(t); if (n != null && n > 0) setDraft((d) => ({ ...d, yield_qty: n })); }} />
                  <Segmented size="sm" ariaLabel="Yield unit" className="w-[150px]" value={prep.yield_unit} onChange={(u: PackUnit) => setDraft((d) => ({ ...d, yield_unit: u }))} options={PACK_UNITS.map((u) => ({ value: u, label: u }))} />
                </span>
              </FieldRow>
            ) : null}
          </div>

          {/* ingredients */}
          <Group title="Ingredients" className="mt-7 lg:[--inset:2.25rem]" trailing={lines.length ? <span className="text-[13px] text-label-2 tnum">{money(recipe.total)} total</span> : null}>
            {lines.length > 1 ? <CostBar lines={recipe.lines} total={recipe.total} /> : null}
            {lines.map((l) => {
              const lc = costById.get(l.id);
              const warn = friendlyWarning(lc, adjusted.has(l.id));
              const open = openLine === l.id;
              return (
                <div
                  key={l.id}
                  draggable={desktop && dragId === l.id}
                  onDragOver={(e) => {
                    if (!dragId) return;
                    e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    dropOn(l.id);
                    setDragId(null);
                  }}
                  onDragEnd={() => setDragId(null)}
                  className={cx("group relative", dragId === l.id && "opacity-40")}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setFocusQtyFor(null);
                      setOpenLine(open ? null : l.id);
                    }}
                    className={cx("relative flex min-h-[56px] w-full items-center gap-3 py-2 pl-4 pr-4 text-left active:bg-fill lg:pl-9 lg:hover:bg-fill", open && "bg-fill")}
                  >
                    <span
                      aria-hidden
                      onMouseDown={() => setDragId(l.id)}
                      onMouseUp={() => setDragId(null)}
                      className="absolute left-1.5 top-1/2 hidden -translate-y-1/2 cursor-grab p-1 text-label-3 opacity-0 transition group-hover:opacity-100 lg:block"
                    >
                      <GripVertical className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[17px] leading-snug sm:text-[15px]">
                        {lc?.componentName ?? "—"}
                        {l.component_type === "prep" ? <PrepBadge /> : null}
                      </span>
                      <span className="mt-0.5 block truncate text-[15px] leading-snug text-label-2 tnum sm:text-[13px]">
                        {Number(l.qty) ? formatQty(l.qty, l.unit) : <span className="text-accent">Add Quantity</span>}
                        {l.note ? ` · ${l.note}` : ""}
                      </span>
                      {warn ? <span className="mt-0.5 block text-[13px] leading-snug text-warn">⚠ {warn}</span> : null}
                    </span>
                    <span className="shrink-0 text-[17px] tnum sm:text-[15px]">{lc ? money(lc.cost) : "—"}</span>
                  </button>
                  {open && desktop ? (
                    <div className="anim-fade border-t-[0.5px] border-sep bg-surface px-9 py-4">
                      <LineEditor
                        key={l.id}
                        line={l}
                        cost={lc}
                        warning={warn}
                        focusQty={focusQtyFor === l.id}
                        excludePrepId={kind === "prep" ? id : undefined}
                        onChange={(p) => patchLine(l.id, p)}
                        onDelete={() => removeLine(l.id)}
                        onDone={() => setOpenLine(null)}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
            <SmartAdd autoFocus={isNew && desktop} excludePrepId={kind === "prep" ? id : undefined} onAdd={addLine} onFocusChange={setAddFocused} />
          </Group>
          {isNew && !desktop && lines.length === 0 ? <MobileAutofocus /> : null}
          {addFocused ? <div className="h-[45vh] lg:hidden" aria-hidden /> : null}
          {itemCost && item && (itemCost.needsCheck || itemCost.hhSellInc != null) ? (
            <div className="mt-6 space-y-2 lg:hidden">
              <CheckCostBanner cost={itemCost} />
              <HappyHourNote cost={itemCost} />
            </div>
          ) : null}
          {itemCost && item ? <PricePicker cost={itemCost} settings={store.settings} setPrice={(p) => setDraft((d) => ({ ...d, sell_price_inc: p }))} /> : null}

          {itemCost && item ? (
            <FixCard
              fix={fix}
              onTrim={() => {
                if (!fix) return;
                patchLine(fix.line.id, { qty: fix.to });
                toast.show({ message: `${fix.name} trimmed to ${formatQty(fix.to, fix.line.unit)}`, action: { label: "Undo", onClick: () => patchLine(fix.line.id, { qty: fix.from }) } });
              }}
            />
          ) : null}

          {item && itemCost ? (
            <div className="group-list mt-6">
              <Row
                onClick={() => setSheet("whatif")}
                leading={
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-accent">
                    <FlaskConical className="h-[18px] w-[18px]" strokeWidth={2.25} />
                  </span>
                }
                title="What If"
                sub="Try a price or portion size without changing the recipe"
                chevron
              />
            </div>
          ) : null}

          {isFlavour ? <GelatoFlavourPanel flavourId={id} mixCost={recipe.total} batchKg={batchWeightKg(lines.filter((l) => l.component_id))} lines={recipe.lines.filter((c) => c.line.component_id)} /> : null}

          {/* prep: used in */}
          {isFlavour ? (
            <div className="group-list mt-6">
              <Row href="/gelato" title={`Sold as ${flavourName(draft)} in ${store.gelato.serves.length} serves`} sub="See every flavour and serve on the Price Grid" chevron />
            </div>
          ) : kind === "prep" ? (
            <div className="group-list mt-6">
              <Row onClick={() => setSheet("usedin")} title={`Used in ${usedIn.items.length} ${usedIn.items.length === 1 ? "recipe" : "recipes"}`} sub={usedIn.preps.length ? `and ${usedIn.preps.length} ${usedIn.preps.length === 1 ? "prep" : "preps"}` : undefined} chevron />
            </div>
          ) : null}

          <RecordResearchNotes kind={kind} id={id} editor={noteTarget} />

          <RecipeAllergens kind={kind} rec={draft} lines={lines} setDraft={setDraft} />
          {item ? <DietOptionsGroup item={item} lines={lines} onPatch={(p) => setDraft((d) => ({ ...d, ...p }) as Rec)} /> : null}

          {item && isBarCategory(item.category) ? <BarDisplayFields item={item} venueSlug={venue?.slug} onPatch={(p) => setDraft((d) => ({ ...d, ...p }) as Rec)} /> : null}
          {(item && item.category === "Food") || (prep && !isFlavour) ? <KitchenDisplayFields kind={kind} rec={draft} venueSlug={venue?.slug} onPatch={(p) => setDraft((d) => ({ ...d, ...p }) as Rec)} /> : null}

          {/* details */}
          <Disclosure title={item ? "Pricing & Notes" : "Type & Notes"} hint={item ? [item.section ? `Section: ${item.section}` : null, item.target_override != null ? `Target ${gp(item.target_override, 0)}` : "Default target", item.hh_price_inc ? `Happy hour ${money(item.hh_price_inc)}${itemCost?.hhBelowCost ? " (below cost)" : itemCost?.hhUnderTarget ? " (below target)" : ""}` : null].filter(Boolean).join(" · ") : prep?.prep_type ?? "Add a type and notes"}>
            <div className="group-list">
              {item ? (
                <>
                  <FieldRow label="Menu Section">
                    <InlineInput value={item.section ?? ""} placeholder="None" inputMode="text" width="w-40" onCommit={(t) => setDraft((d) => ({ ...d, section: t.trim() || null }))} />
                  </FieldRow>
                  <FieldRow label="Target GP" sub={`Default for ${venue?.name ?? "venue"} ${item.category}: ${gp(store.targets.find((t) => t.venue_id === item.venue_id && t.category === item.category)?.target_gp ?? 0.7, 0)}`}>
                    <InlineInput
                      value={item.target_override != null ? String(Math.round(item.target_override * 1000) / 10) : ""}
                      placeholder="Default"
                      suffix="%"
                      onCommit={(t) => setDraft((d) => ({ ...d, target_override: t.trim() ? parseGpInput(t) : null }))}
                    />
                  </FieldRow>
                  <FieldRow label="Happy Hour Price" sub={item.hh_price_inc && itemCost ? (
                    <span className={itemCost.hhUnderTarget || itemCost.hhBelowCost ? "font-medium text-danger" : undefined}>
                      GP {gp(gpForPrice(itemCost.costPerPortion, item.hh_price_inc, store.settings.gst_rate))}
                      {itemCost.hhBelowCost ? ", below cost" : itemCost.hhUnderTarget ? `, below the ${gp(itemCost.targetGp, 0)} target` : ""}
                    </span>
                  ) : undefined}>
                    <InlineInput value={item.hh_price_inc != null ? Number(item.hh_price_inc).toFixed(2) : ""} placeholder="None" prefix="$" onCommit={(t) => setDraft((d) => ({ ...d, hh_price_inc: parsePriceInput(t) }))} />
                  </FieldRow>
                </>
              ) : prep ? (
                <FieldRow label="Type">
                  <InlineInput value={prep.prep_type ?? ""} placeholder="e.g. Sauce" inputMode="text" width="w-40" onCommit={(t) => setDraft((d) => ({ ...d, prep_type: t.trim() || null }))} />
                </FieldRow>
              ) : null}
              <div className="px-4 py-2.5">
                <textarea
                  rows={2}
                  value={draft.notes ?? ""}
                  placeholder="Notes"
                  onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value || null }))}
                  className="block w-full resize-none bg-transparent text-[17px] outline-none placeholder:text-label-3 sm:text-[15px]"
                />
              </div>
            </div>
          </Disclosure>
          {item ? <PriceHistory filter={{ kind: "item", itemId: item.id }} refreshKey={`${item.sell_price_inc}|${item.hh_price_inc}`} cost={itemCost?.costPerPortion} gst={store.settings.gst_rate} /> : null}
        </div>

        {/* summary: desktop column */}
        <aside className="hidden lg:block">
          <div className="sticky top-8 mt-2">
            {itemCost && item ? (
              <ItemSummaryCard cost={itemCost} settings={store.settings} setPrice={(p) => setDraft((d) => ({ ...d, sell_price_inc: p }))} />
            ) : prep ? (
              <PrepSummary variant="card" batchCost={recipe.total} costPerUnit={prepCostPerUnit} unit={prep.yield_unit} />
            ) : null}
          </div>
        </aside>
      </div>

      {/* save bar: sticky at the bottom on desktop; on phones it sits at the top of the fixed summary bar */}
      <SaveBar state={saveState} onSave={() => void save()} onDiscard={() => setSheet("discard")} className="sticky bottom-0 z-30 mt-8 hidden rounded-t-2xl bg-surface px-4 py-3 shadow-float ring-1 ring-[color:var(--separator)] lg:flex" />
      <div className="h-14 lg:hidden" aria-hidden />

      {/* summary: phone bar */}
      {itemCost && item ? (
        <ItemSummaryBar top={phoneSaveBar} cost={itemCost} settings={store.settings} setPrice={(p) => setDraft((d) => ({ ...d, sell_price_inc: p }))} />
      ) : prep ? (
        <PrepSummary variant="bar" top={phoneSaveBar} batchCost={recipe.total} costPerUnit={prepCostPerUnit} unit={prep.yield_unit} />
      ) : null}

      {/* line sheet (phones) */}
      <Sheet open={!desktop && !!openLineObj} onClose={() => setOpenLine(null)} title={openLineObj ? costById.get(openLineObj.id)?.componentName : ""} cancelLabel={null} action={{ label: "Done", onClick: () => setOpenLine(null) }}>
        {openLineObj ? (
          <div className="pb-2 pt-3">
            <LineEditor
              key={openLineObj.id}
              line={openLineObj}
              cost={costById.get(openLineObj.id)}
              warning={friendlyWarning(costById.get(openLineObj.id), adjusted.has(openLineObj.id))}
              focusQty={focusQtyFor === openLineObj.id}
              excludePrepId={kind === "prep" ? id : undefined}
              onChange={(p) => patchLine(openLineObj.id, p)}
              onDelete={() => removeLine(openLineObj.id)}
              onMove={(dir) => moveLine(openLineObj.id, dir)}
              canUp={lines[0]?.id !== openLineObj.id}
              canDown={lines[lines.length - 1]?.id !== openLineObj.id}
              showMove
            />
          </div>
        ) : null}
      </Sheet>

      {/* venue / category pickers */}
      <Sheet open={sheet === "venue"} onClose={() => setSheet(null)} title="Venue" cancelLabel={null} action={{ label: "Done", onClick: () => setSheet(null) }}>
        <div className="group-list mt-3">
          {kind === "prep" ? <Row title="Shared" onClick={() => { setDraft((d) => ({ ...d, venue_id: null }) as Rec); setSheet(null); }} trailing={(draft as Prep).venue_id == null ? <span className="text-accent">✓</span> : null} /> : null}
          {store.venues.map((v) => (
            <Row
              key={v.id}
              title={v.name}
              leading={<Dot className={cx(`v-${v.slug}`, "bg-accent-fill")} />}
              onClick={() => {
                setDraft((d) => ({ ...d, venue_id: v.id }) as Rec);
                setSheet(null);
              }}
              trailing={(draft as MenuItem).venue_id === v.id ? <span className="text-accent">✓</span> : null}
            />
          ))}
        </div>
      </Sheet>
      <Sheet open={sheet === "category"} onClose={() => setSheet(null)} title="Category" cancelLabel={null} action={{ label: "Done", onClick: () => setSheet(null) }}>
        <div className="group-list mt-3">
          {MENU_CATEGORIES.map((c) => (
            <Row
              key={c}
              title={c}
              onClick={() => {
                setDraft((d) => ({ ...d, category: c }) as Rec);
                setSheet(null);
              }}
              trailing={item?.category === c ? <span className="text-accent">✓</span> : null}
            />
          ))}
        </div>
      </Sheet>
      {sheet === "whatif" && itemCost && item ? (
        <WhatIfSheet
          cost={itemCost}
          item={item}
          lines={lines}
          onClose={() => setSheet(null)}
          onApply={(price, k) => {
            const prev = { price: item.sell_price_inc, lines: linesRef.current };
            setDraft((d) => ({ ...d, sell_price_inc: price }));
            if (k !== 1) setLines((ls) => ls.map((l) => ({ ...l, qty: Math.round(Number(l.qty) * k * 1000) / 1000 })));
            setSheet(null);
            toast.show({
              message: k !== 1 ? `Portion ${k > 1 ? "+" : "−"}${Math.round(Math.abs(k - 1) * 100)}% and price applied` : "Price applied",
              action: {
                label: "Undo",
                onClick: () => {
                  setDraft((d) => ({ ...d, sell_price_inc: prev.price }));
                  if (k !== 1) setLines(() => prev.lines);
                },
              },
            });
          }}
        />
      ) : null}
      <DiscardSheet open={sheet === "discard"} count={changes.count} labels={changes.labels} onConfirm={discard} onClose={() => setSheet(null)} />
      {sheet === "duplicate" ? <DuplicateSheet kind={kind} draft={draft} lines={lines} onClose={() => setSheet(null)} /> : null}
      {sheet === "delete" ? <DeleteSheet kind={kind} rec={draft} inUse={usedIn.items.length + usedIn.preps.length} onClose={() => setSheet(null)} onDeleted={() => router.push(backHref)} beforeDelete={release} /> : null}
      <Sheet open={sheet === "usedin"} onClose={() => setSheet(null)} title="Used In" cancelLabel={null} action={{ label: "Done", onClick: () => setSheet(null) }}>
        {usedIn.items.length + usedIn.preps.length === 0 ? (
          <p className="py-8 text-center text-[15px] text-label-2">Not used in any recipe yet.</p>
        ) : (
          <>
            {usedIn.items.length ? (
              <Group title="Recipes" className="mt-3">
                {usedIn.items.map((it) => {
                  const c = store.itemCosts.get(it.id);
                  return <Row key={it.id} href={`/items/${it.id}`} title={it.name} sub={store.venueById.get(it.venue_id)?.name} trailing={c?.gpPct != null ? gp(c.gpPct) : null} chevron />;
                })}
              </Group>
            ) : null}
            {usedIn.preps.length ? (
              <Group title="Preps">
                {usedIn.preps.map((p) => (
                  <Row key={p.id} href={`/preps/${p.id}`} title={p.name} chevron />
                ))}
              </Group>
            ) : null}
          </>
        )}
      </Sheet>
    </div>
  );
}

/** iOS only opens the keyboard for focus() inside a user gesture; on phones we focus after mount as a best effort. */
function MobileAutofocus() {
  useEffect(() => {
    const t = window.setTimeout(() => {
      document.querySelector<HTMLInputElement>('input[aria-label="Add Ingredient"]')?.focus();
    }, 350);
    return () => window.clearTimeout(t);
  }, []);
  return null;
}

function DuplicateSheet({ kind, draft, lines, onClose }: { kind: Kind; draft: Rec; lines: RecipeLine[]; onClose: () => void }) {
  const store = useStore();
  const router = useGuardedRouter();
  const [venueId, setVenueId] = useState<number | null>((draft as MenuItem).venue_id ?? null);
  const [name, setName] = useState(draft.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = lines.filter((l) => l.component_id);

  async function go() {
    if (!name.trim() || (kind === "item" && venueId == null)) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === "item") {
        const { id: _i, ...rest } = draft as MenuItem;
        void _i;
        const nid = await store.insertItem(
          { ...rest, name: name.trim(), venue_id: venueId!, source: "duplicate" },
          clean.map((l, i) => ({ component_type: l.component_type, component_id: l.component_id, qty: l.qty, unit: l.unit, note: l.note, sort: i + 1 })),
        );
        onClose();
        router.push(`/items/${nid}`);
      } else {
        const { id: _i, ...rest } = draft as Prep;
        void _i;
        const finalName = name.trim() === draft.name ? `${name.trim()} (${VENUE_SHORT[store.venueById.get(venueId ?? -1)?.slug ?? ""] ?? "copy"})` : name.trim();
        const nid = await store.insertPrep({ ...rest, name: finalName, venue_id: venueId, source: "duplicate" });
        if (clean.length) await store.saveLines("prep", nid, clean.map((l, i) => ({ ...l, id: newId(), parent_type: "prep", parent_id: nid, sort: i + 1 })));
        onClose();
        router.push(`/preps/${nid}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title="Duplicate" action={{ label: busy ? "Copying…" : "Copy", onClick: () => void go(), disabled: busy || !name.trim() }}>
      <div className="space-y-5 pb-2 pt-3">
        {error ? <Banner>{error}</Banner> : null}
        <input className="field !text-[20px] font-semibold" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
        <div>
          <p className="section-label !px-1">Copy to</p>
          <Chips
            ariaLabel="Venue"
            value={venueId == null ? "" : String(venueId)}
            onChange={(v) => setVenueId(Number(v))}
            options={store.venues.map((v) => ({ value: String(v.id), label: VENUE_SHORT[v.slug] ?? v.name, className: venueId === v.id ? `v-${v.slug}` : undefined }))}
            className="[&>button:not([aria-checked=true])]:bg-fill"
          />
        </div>
        <p className="px-1 text-[13px] text-label-2">Copies the recipe and its {clean.length} ingredient lines.</p>
        <button className="btn-primary w-full" disabled={busy || !name.trim()} onClick={() => void go()}>
          {busy ? "Copying…" : "Duplicate"}
        </button>
      </div>
    </Sheet>
  );
}

function DeleteSheet({ kind, rec, inUse, onClose, onDeleted, beforeDelete }: { kind: Kind; rec: Rec; inUse: number; onClose: () => void; onDeleted: () => void; beforeDelete: () => Promise<void> | void }) {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = kind === "prep" && inUse > 0;
  async function del() {
    setBusy(true);
    try {
      await beforeDelete();
      if (kind === "item") await store.deleteItem(rec.id);
      else await store.deletePrep(rec.id);
      onClose();
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }
  return (
    <Sheet open onClose={onClose} hideHeader size="sm">
      <div className="pb-2 pt-5 text-center">
        <p className="text-[20px] font-semibold">Delete “{rec.name}”?</p>
        <p className="mx-auto mt-1.5 max-w-xs text-[15px] text-label-2">
          {blocked ? `This prep is used in ${inUse} ${inUse === 1 ? "recipe" : "recipes"}. Remove it from those first, or make it inactive instead.` : "This removes the recipe and its ingredient lines. This can’t be undone."}
        </p>
        {error ? <Banner>{error}</Banner> : null}
        <div className="mt-5 space-y-2">
          {!blocked ? (
            <button className="btn w-full bg-danger-soft text-danger" disabled={busy} onClick={() => void del()}>
              {busy ? "Deleting…" : "Delete"}
            </button>
          ) : null}
          <button className="btn-plain w-full" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Sheet>
  );
}

