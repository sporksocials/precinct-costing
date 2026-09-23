"use client";

import { useRouter } from "next/navigation";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { MENU_CATEGORIES, type MenuItem, type Prep } from "@/lib/types";
import { Banner, Chips, Segmented, Sheet } from "./ui";
import { VENUE_SHORT } from "./venue";

type RecipeType = "item" | "prep";
interface OpenArgs {
  venueId?: number | null;
  type?: RecipeType;
}

const Ctx = createContext<{ open: (a?: OpenArgs) => void } | null>(null);

export function useNewRecipe() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useNewRecipe outside provider");
  return c;
}

export function NewRecipeProvider({ children }: { children: React.ReactNode }) {
  const [args, setArgs] = useState<OpenArgs | null>(null);
  const open = useCallback((a?: OpenArgs) => setArgs(a ?? {}), []);
  return (
    <Ctx.Provider value={{ open }}>
      {children}
      {args ? <NewRecipeSheet args={args} onClose={() => setArgs(null)} /> : null}
    </Ctx.Provider>
  );
}

function NewRecipeSheet({ args, onClose }: { args: OpenArgs; onClose: () => void }) {
  const store = useStore();
  const router = useRouter();
  const [name, setName] = useState("");
  const [venueId, setVenueId] = useState<number | null>(args.venueId ?? null);
  const [type, setType] = useState<RecipeType>(args.type ?? "item");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // categories: those the venue already uses first, then the rest
  const cats = useMemo(() => {
    const used = new Set(store.items.filter((i) => i.venue_id === venueId).map((i) => i.category));
    return [...MENU_CATEGORIES].sort((a, b) => Number(used.has(b)) - Number(used.has(a)));
  }, [store.items, venueId]);
  const [category, setCategory] = useState<string>("");
  useEffect(() => {
    const v = store.venueById.get(venueId ?? -1);
    setCategory((c) => c || (v?.slug === "gelato" ? "Gelato" : "Food"));
  }, [venueId, store.venueById]);

  const canCreate = name.trim().length > 0 && venueId != null && (type === "prep" || !!category) && !busy;

  async function create() {
    if (!canCreate || venueId == null) return;
    setBusy(true);
    setError(null);
    try {
      if (type === "item") {
        const item: Omit<MenuItem, "id"> = {
          name: name.trim(),
          venue_id: venueId,
          category,
          section: null,
          portions: 1,
          sell_price_inc: null,
          target_override: null,
          hh_price_inc: null,
          active: true,
          source: "app",
          notes: null,
        };
        const id = await store.insertItem(item, []);
        onClose();
        router.push(`/items/${id}?new=1`);
      } else {
        const prep: Omit<Prep, "id"> = { name: name.trim(), venue_id: venueId, prep_type: null, yield_qty: 1, yield_unit: "kg", active: true, source: "app", notes: null };
        const id = await store.insertPrep(prep);
        onClose();
        router.push(`/preps/${id}?new=1`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title="New recipe" action={{ label: busy ? "Creating…" : "Create", onClick: () => void create(), disabled: !canCreate }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
        className="space-y-5 pb-2 pt-3"
      >
        {error ? <Banner>{error}</Banner> : null}
        <input
          autoFocus
          className="field !py-3.5 !text-[20px] font-semibold"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          enterKeyHint="done"
          aria-label="Recipe name"
        />
        <div>
          <p className="section-label !px-1">Venue{venueId == null ? <span className="text-danger"> · choose one</span> : null}</p>
          <Chips
            ariaLabel="Venue"
            value={venueId == null ? "" : String(venueId)}
            onChange={(v) => setVenueId(Number(v))}
            options={store.venues.map((v) => ({ value: String(v.id), label: VENUE_SHORT[v.slug] ?? v.name, className: venueId === v.id ? `v-${v.slug}` : undefined }))}
            className="[&>button:not([aria-checked=true])]:bg-fill"
          />
        </div>
        <div>
          <p className="section-label !px-1">Type</p>
          <Segmented
            ariaLabel="Type"
            value={type}
            onChange={setType}
            options={[
              { value: "item", label: "Menu item" },
              { value: "prep", label: "Prep (batch)" },
            ]}
          />
        </div>
        {type === "item" ? (
          <div>
            <p className="section-label !px-1">Category</p>
            <Chips ariaLabel="Category" value={category} onChange={setCategory} options={cats.map((c) => ({ value: c, label: c }))} className="flex-wrap [&>button:not([aria-checked=true])]:bg-fill" />
          </div>
        ) : (
          <p className="px-1 text-[13px] text-label-2">Starts as a 1 kg batch — change the yield in the editor.</p>
        )}
        <button type="submit" className="btn-primary w-full" disabled={!canCreate}>
          {busy ? "Creating…" : "Create"}
        </button>
      </form>
    </Sheet>
  );
}
