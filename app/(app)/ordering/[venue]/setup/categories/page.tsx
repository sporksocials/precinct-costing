"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { blankCategory, createCategory, OrderingError, updateCategory, type CategoryDraft } from "@/lib/ordering-data";
import { defaultUnitForCategory } from "@/lib/ordering";
import { applySort, bySortThenName, moveItem, nameTaken, placesText, SECOND_PLACE_OPTIONS, secondPlaceChoice, sortChanges, UNIT_CHOICE_OPTIONS, unitChoice, unitTitle, type SecondPlaceChoice, type UnitChoice } from "@/lib/ordering-setup";
import { saveSortChanges } from "@/lib/ordering-screens-data";
import { Banner, Empty, PageHeader } from "@/components/ui";
import { useOrderingVenue } from "@/components/ordering/venue-context";
import { upsertById, useVenueData } from "@/components/ordering/use-venue-data";
import { SortableRows } from "@/components/ordering/sortable";
import { ChoiceBlock, SaveNote, TextField, TouchAddButton, TouchBack, TouchChips, TouchSheet } from "@/components/ordering/touch";
import type { OrderingCategory } from "@/lib/ordering-types";

type Save = { state: "idle" | "saving" | "saved" | "error"; message: string | null };

/** The fields of a category, used by both Add Category (nothing saved until Add) and Edit (every change saves at once). */
function CategoryFields({
  name,
  unit,
  second,
  nameError,
  onName,
  onUnit,
  onSecond,
  commitName,
}: {
  name: string;
  unit: string;
  second: string | null;
  nameError: string | null;
  onName: (t: string) => void;
  onUnit: (u: string) => void;
  onSecond: (label: string | null) => void;
  /** Edit saves the name when the field is left; Add reads it from onName */
  commitName?: (t: string) => void;
}) {
  // "Other" is a choice that has no value of its own until a word is typed, so it is remembered here
  const [otherUnit, setOtherUnit] = useState(unitChoice(unit) === "other");
  const [otherSecond, setOtherSecond] = useState(secondPlaceChoice(second) === "other");
  const unitPick: UnitChoice = otherUnit ? "other" : unitChoice(unit);
  const secondPick: SecondPlaceChoice = otherSecond ? "other" : secondPlaceChoice(second);
  return (
    <div className="-mx-4">
      <TextField label="Category Name" value={name} error={nameError} onCommit={(t) => commitName?.(t)} onChangeText={onName} placeholder="Spirits" />
      <ChoiceBlock label="Counted In" hint="Where this category is counted. Soft drink uses the store only.">
        <TouchChips
          wrap
          ariaLabel="Where this category is counted"
          options={SECOND_PLACE_OPTIONS}
          value={secondPick}
          onChange={(v) => {
            setOtherSecond(v === "other");
            if (v === "none") onSecond(null);
            else if (v !== "other") onSecond(v);
          }}
        />
        {secondPick === "other" ? (
          <div className="-mx-4 mt-1">
            <TextField label="Second Place Name" value={secondPlaceChoice(second) === "other" ? second ?? "" : ""} placeholder="Cellar" onCommit={(t) => t.trim() && onSecond(t.trim())} />
          </div>
        ) : null}
      </ChoiceBlock>
      <ChoiceBlock label="Default Unit" hint="New products in this category start with this unit. Each product can still use its own.">
        <TouchChips
          wrap
          ariaLabel="Default unit"
          options={UNIT_CHOICE_OPTIONS}
          value={unitPick}
          onChange={(v) => {
            setOtherUnit(v === "other");
            if (v !== "other") onUnit(v);
          }}
        />
        {unitPick === "other" ? (
          <div className="-mx-4 mt-1">
            <TextField label="Unit Name" value={unitChoice(unit) === "other" ? unit : ""} placeholder="tray" onCommit={(t) => t.trim() && onUnit(t.trim().toLowerCase())} />
          </div>
        ) : null}
      </ChoiceBlock>
    </div>
  );
}

export default function OrderingCategoriesPage() {
  const { venue, name, base } = useOrderingVenue();
  const { sb, data, status, error, apply, reload } = useVenueData(venue.id);
  const [save, setSave] = useState<Save>({ state: "idle", message: null });
  const [editId, setEditId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<CategoryDraft>(blankCategory());
  const [addError, setAddError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // the unit follows the name you type (Kegs gives keg) until you pick one yourself
  const unitPicked = useRef(false);

  const categories = useMemo(() => bySortThenName(data?.categories ?? []), [data?.categories]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of data?.products ?? []) if (p.active) m.set(p.category_id, (m.get(p.category_id) ?? 0) + 1);
    return m;
  }, [data?.products]);
  const editing = categories.find((c) => c.id === editId) ?? null;

  const onMove = useCallback(
    async (from: number, to: number) => {
      const ordered = moveItem(categories, from, to);
      const changes = sortChanges(ordered);
      if (!changes.length) return;
      apply((d) => ({ ...d, categories: applySort(d.categories, changes) }));
      setSave({ state: "saving", message: null });
      try {
        await saveSortChanges(sb, "categories", changes);
        setSave({ state: "saved", message: null });
      } catch (e) {
        setSave({ state: "error", message: `${e instanceof Error ? e.message : String(e)} The order on screen was put back.` });
        void reload();
      }
    },
    [categories, apply, sb, reload],
  );

  async function patch(id: string, p: Partial<CategoryDraft>) {
    setSave({ state: "saving", message: null });
    try {
      const row = await updateCategory(sb, id, p);
      apply((d) => ({ ...d, categories: upsertById(d.categories, row) }));
      setSave({ state: "saved", message: null });
    } catch (e) {
      setSave({ state: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  useEffect(() => setEditError(null), [editId]);

  async function create() {
    const n = draft.name.trim();
    if (!n) return setAddError("Type the category's name.");
    if (nameTaken(n, categories)) return setAddError(`${name} already has a category called ${n}.`);
    setBusy(true);
    setAddError(null);
    try {
      const sort = Math.max(0, ...categories.map((c) => c.sort)) + 1;
      const row = await createCategory(sb, venue.id, { ...draft, name: n, sort });
      apply((d) => ({ ...d, categories: upsertById(d.categories, row) }));
      setAdding(false);
    } catch (e) {
      setAddError(e instanceof OrderingError || e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl lg:pt-6">
      <TouchBack path={`${base}/setup`} fallback={`${base}/setup`}>
        Setup
      </TouchBack>
      <PageHeader
        title="Categories"
        subtitle={`${name} only`}
        trailing={
          <TouchAddButton
            label="Add Category"
            onClick={() => {
              setDraft(blankCategory());
              unitPicked.current = false;
              setAddError(null);
              setAdding(true);
            }}
          />
        }
        className="lg:!pt-2"
      />
      <p className="text-[15px] text-label-2">The count follows this order, so put categories in shelf order. Drag the handle, or use the arrows.</p>
      <SaveNote state={save.state} message={save.message} />
      {error && !data ? <Banner>{error}</Banner> : null}

      {status === "ready" && categories.length === 0 ? (
        <Empty title="No categories yet" body={`Add the groups ${name} counts in, like Kegs, Spirits or Wine.`} />
      ) : (
        <div className="mt-3">
          <SortableRows
            items={categories}
            getId={(c) => c.id}
            getLabel={(c) => c.name}
            onMove={(f, t) => void onMove(f, t)}
            renderBody={(c: OrderingCategory) => (
              <button type="button" onClick={() => {
                  setSave({ state: "idle", message: null });
                  setEditId(c.id);
                }} className="flex min-h-[56px] w-full flex-col justify-center rounded-lg px-1 text-left active:bg-fill">
                <span className="block truncate text-[17px]">{c.name}</span>
                <span className="block text-[13px] text-label-2">
                  {unitTitle(c.unit_name)} · {placesText(c.second_location_label)} · {counts.get(c.id) ?? 0} products
                </span>
              </button>
            )}
          />
        </div>
      )}

      <TouchSheet open={adding} onClose={() => (busy ? undefined : setAdding(false))} title="Add Category" action={{ label: busy ? "Adding..." : "Add", onClick: () => void create(), disabled: busy }}>
        <CategoryFields
          name={draft.name}
          unit={draft.unit_name}
          second={draft.second_location_label}
          nameError={addError}
          onName={(t) => setDraft((d) => ({ ...d, name: t, unit_name: unitPicked.current ? d.unit_name : defaultUnitForCategory(t) }))}
          onUnit={(u) => {
            unitPicked.current = true;
            setDraft((d) => ({ ...d, unit_name: u }));
          }}
          onSecond={(l) => setDraft((d) => ({ ...d, second_location_label: l }))}
        />
      </TouchSheet>

      <TouchSheet open={!!editing} onClose={() => setEditId(null)} title="Edit Category" cancelLabel="Done">
        {editing ? (
          <>
            <CategoryFields
              key={editing.id}
              name={editing.name}
              unit={editing.unit_name}
              second={editing.second_location_label}
              nameError={editError}
              onName={() => setEditError(null)}
              commitName={(t) => {
                const n = t.trim();
                if (!n) return setEditError("A category needs a name.");
                if (nameTaken(n, categories, editing.id)) return setEditError(`${name} already has a category called ${n}.`);
                setEditError(null);
                void patch(editing.id, { name: n });
              }}
              onUnit={(u) => void patch(editing.id, { unit_name: u })}
              onSecond={(l) => void patch(editing.id, { second_location_label: l })}
            />
            <SaveNote state={save.state} message={save.message} />
          </>
        ) : null}
      </TouchSheet>
    </div>
  );
}
