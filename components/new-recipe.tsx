"use client";

import { useRouter } from "next/navigation";
import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { MENU_CATEGORIES, type MenuItem, type Prep } from "@/lib/types";
import { Banner, Chips, Sheet } from "./ui";
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
  // category follows a guess from the name until it's picked by hand
  const [picked, setPicked] = useState<string | null>(null);
  const guessed = useMemo(() => guessCategory(name, store.venueById.get(venueId ?? -1)?.slug, store.items.filter((i) => i.venue_id === venueId)), [name, venueId, store.venueById, store.items]);
  const category = picked ?? guessed;
  const setCategory = (c: string) => setPicked(c);

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
    <Sheet open onClose={onClose} title={type === "prep" ? "New Prep" : "New Menu Item"} action={{ label: busy ? "Creating…" : "Create", onClick: () => void create(), disabled: !canCreate }}>
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
          placeholder={type === "prep" ? "Prep name, e.g. Hollandaise" : "Dish or drink name"}
          value={name}
          onChange={(e) => setName(e.target.value)}
          enterKeyHint="done"
          aria-label="Recipe Name"
        />
        <div>
          <p className="section-label !px-1">Venue{venueId == null ? <span className="text-danger"> · Choose One</span> : null}</p>
          <Chips
            ariaLabel="Venue"
            value={venueId == null ? "" : String(venueId)}
            onChange={(v) => setVenueId(Number(v))}
            options={store.venues.map((v) => ({ value: String(v.id), label: VENUE_SHORT[v.slug] ?? v.name, className: venueId === v.id ? `v-${v.slug}` : undefined }))}
            className="[&>button:not([aria-checked=true])]:bg-fill"
          />
        </div>
        {type === "item" ? (
          <div>
            <p className="section-label !px-1">Category{!picked && name.trim() ? <span className="text-label-3"> · guessed from the name</span> : null}</p>
            <Chips ariaLabel="Category" value={category} onChange={setCategory} options={cats.map((c) => ({ value: c, label: c }))} className="flex-wrap [&>button:not([aria-checked=true])]:bg-fill" />
          </div>
        ) : (
          <p className="px-1 text-[13px] text-label-2">A prep is a batch recipe (sauce, dough, mix) used inside menu items. It starts as a 1 kg batch; set the yield in the editor.</p>
        )}
        <button type="button" onClick={() => setType((t) => (t === "item" ? "prep" : "item"))} className="px-1 text-[15px] font-medium text-accent">
          {type === "item" ? "Make It a Prep Instead" : "Make It a Menu Item Instead"}
        </button>
        <button type="submit" className="btn-primary w-full" disabled={!canCreate}>
          {busy ? "Creating…" : "Create"}
        </button>
      </form>
    </Sheet>
  );
}

const KEYWORDS: [RegExp, string][] = [
  [/\b(nip|30 ?ml|shot)\b/i, "Spirits"],
  [/\b(pint|pot|schooner|jug|middy|tap)\b/i, "Tap Beer"],
  [/\b(stubby|can|bottle of beer|cider|seltzer)\b/i, "Packaged Beer & Cider"],
  [/\b(rtd|premix|cruiser|smirnoff)\b/i, "RTD"],
  [/\b(merlot|shiraz|sauv|sauvignon|pinot|chardonnay|ros[eé]|prosecco|riesling|moscato|cabernet|tempranillo|glass|carafe|bubbles|champagne)\b/i, "Wine"],
  [/\b(virgin|mocktail|spider|shake|smoothie|lemonade|iced tea|soda)\b/i, "Mocktail"],
  [/\b(margarita|spritz|martini|mojito|negroni|sour|daiquiri|colada|mule|paloma|old fashioned|cocktail|punch|highball|bellini|cosmo)\b/i, "Cocktail"],
  [/\b(gelato|sorbet|scoop|cone|affogato)\b/i, "Gelato"],
];

/** Best guess at a new item's category: a similar existing name at this venue, then drink keywords, then the venue's usual. */
function guessCategory(name: string, venueSlug: string | undefined, venueItems: MenuItem[]): string {
  const n = name.trim().toLowerCase();
  const fallback = venueSlug === "gelato" ? "Gelato" : venueItems.length ? mostCommon(venueItems.map((i) => i.category)) ?? "Food" : "Food";
  if (n.length < 3) return fallback;
  for (const [re, cat] of KEYWORDS) if (re.test(n)) return cat;
  const words = n.split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  const similar = venueItems.filter((i) => words.some((w) => i.name.toLowerCase().includes(w)));
  return mostCommon(similar.map((i) => i.category)) ?? fallback;
}

function mostCommon(xs: string[]): string | null {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [k, v] of m) if (v > n) [best, n] = [k, v];
  return best;
}
