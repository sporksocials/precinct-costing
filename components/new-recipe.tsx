"use client";

import { useGuardedRouter } from "@/components/unsaved-guard";
import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { initialResearchStatus } from "@/lib/research-drink";
import { type MenuItem, type Prep } from "@/lib/types";
import { DRINK_CATEGORIES } from "@/lib/insights";
import { parseServeCount, portionsForMode, type ServesMode } from "@/lib/serves";
import { NEW_ITEM_CATEGORIES, beerDefaultVenueId, guessCategory, type AddChoice, type AddDestination } from "@/lib/add-choices";
import { Banner, Chips, FieldRow, Sheet } from "./ui";
import { ServesSegmented } from "./serves-choice";
import { VENUE_SHORT } from "./venue";
import { NameSuggestRow, useNameTidy } from "./name-suggest";
import { AddChooserSheet, SheetBack } from "./add-chooser";
import { NewBeerSheet } from "./beer-parts";
import { NewFlavourSheet } from "./new-flavour";

type RecipeType = "item" | "prep";
interface OpenArgs {
  venueId?: number | null;
  type?: RecipeType;
  /** New Menu Item only: start on this category (the person can still change it). Tap Beer and Gelato are ignored. */
  category?: string;
}

/** Which step is showing. `back` is set when the form was reached from the "What Are You Adding?" chooser. */
type Stage =
  | { step: "choose"; venueId: number | null }
  | { step: "recipe"; args: OpenArgs; back: boolean; venueId: number | null }
  | { step: "beer"; venueId: number | undefined; back: boolean; chooserVenueId: number | null }
  | { step: "flavour"; venueId: number; back: boolean; chooserVenueId: number | null };

const Ctx = createContext<{
  /** Open the New Menu Item (or New Prep) form directly. */
  open: (a?: OpenArgs) => void;
  /** Open the "What Are You Adding?" chooser, which goes on to the right form. */
  choose: (a?: { venueId?: number | null }) => void;
} | null>(null);

export function useNewRecipe() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useNewRecipe outside provider");
  return c;
}

export function NewRecipeProvider({ children }: { children: React.ReactNode }) {
  const store = useStore();
  const [stage, setStage] = useState<Stage | null>(null);
  const gelatoVenueId = store.gelato.venue?.id;

  /** The stage for a chooser tile, with the chooser's venue carried through. */
  const stageFor = useCallback(
    (d: AddDestination, venueId: number | null, back: boolean): Stage | null => {
      if (d.kind === "beer") return { step: "beer", venueId: beerDefaultVenueId(store.venues.find((v) => v.id === venueId), store.venues), back, chooserVenueId: venueId };
      if (d.kind === "flavour") return gelatoVenueId == null ? null : { step: "flavour", venueId: gelatoVenueId, back, chooserVenueId: venueId };
      if (d.kind === "prep") return { step: "recipe", args: { venueId, type: "prep" }, back, venueId };
      return { step: "recipe", args: { venueId, type: "item", category: d.category }, back, venueId };
    },
    [store.venues, gelatoVenueId],
  );

  const open = useCallback((a?: OpenArgs) => setStage({ step: "recipe", args: a ?? {}, back: false, venueId: a?.venueId ?? null }), []);
  const choose = useCallback((a?: { venueId?: number | null }) => setStage({ step: "choose", venueId: a?.venueId ?? null }), []);
  const value = useMemo(() => ({ open, choose }), [open, choose]);

  const close = () => setStage(null);
  const backToChooser = (venueId: number | null) => setStage({ step: "choose", venueId });
  return (
    <Ctx.Provider value={value}>
      {children}
      {stage?.step === "choose" ? (
        <AddChooserSheet
          onClose={close}
          hide={(c: AddChoice) => c.destination.kind === "flavour" && gelatoVenueId == null}
          onPick={(c) => setStage(stageFor(c.destination, stage.venueId, true))}
        />
      ) : null}
      {stage?.step === "recipe" ? <NewRecipeSheet key={`${stage.args.type ?? "item"}:${stage.args.category ?? ""}`} args={stage.args} onClose={close} onBack={stage.back ? () => backToChooser(stage.venueId) : undefined} /> : null}
      {stage?.step === "beer" ? <NewBeerSheet defaultVenueId={stage.venueId} onClose={close} onBack={stage.back ? () => backToChooser(stage.chooserVenueId) : undefined} /> : null}
      {stage?.step === "flavour" ? <NewFlavourSheet venueId={stage.venueId} onClose={close} onBack={stage.back ? () => backToChooser(stage.chooserVenueId) : undefined} /> : null}
    </Ctx.Provider>
  );
}

function NewRecipeSheet({ args, onClose, onBack }: { args: OpenArgs; onClose: () => void; onBack?: () => void }) {
  const store = useStore();
  const router = useGuardedRouter();
  const [name, setName] = useState("");
  const [venueId, setVenueId] = useState<number | null>(args.venueId ?? null);
  const type: RecipeType = args.type ?? "item";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One Serve by default; Multiple Serves reveals the number (2 or more)
  const [servesMode, setServesMode] = useState<ServesMode>("one");
  // kept as typed and read when Create is pressed, so a number still being typed is never lost
  const [serveText, setServeText] = useState("2");

  // categories: those the venue already uses first, then the rest
  const cats = useMemo(() => {
    const used = new Set(store.items.filter((i) => i.venue_id === venueId).map((i) => i.category));
    return [...NEW_ITEM_CATEGORIES].sort((a, b) => Number(used.has(b)) - Number(used.has(a)));
  }, [store.items, venueId]);
  // category follows a guess from the name until it's picked by hand
  // (a category chosen on the "What Are You Adding?" step counts as picked by hand)
  const [picked, setPicked] = useState<string | null>(args.category && NEW_ITEM_CATEGORIES.includes(args.category) ? args.category : null);
  const guessed = useMemo(() => guessCategory(name, store.items.filter((i) => i.venue_id === venueId)), [name, venueId, store.items]);
  const category = picked ?? guessed;
  const setCategory = (c: string) => setPicked(c);
  // spelling and capitals: tidy on leaving the field, "Did you mean" under it (nothing is saved by it)
  const nt = useNameTidy({ kind: type === "prep" ? "prep" : DRINK_CATEGORIES.has(category) ? "drink" : "menu_item", value: name, setValue: setName });

  const canCreate = name.trim().length > 0 && venueId != null && (type === "prep" || !!category) && !busy;

  async function create() {
    if (!canCreate || venueId == null) return;
    setBusy(true);
    setError(null);
    // a name still being typed when Create is pressed (Enter) is tidied the same way as one the person left
    const finalName = nt.settle(name);
    try {
      if (type === "item") {
        const item: Omit<MenuItem, "id"> = {
          name: finalName,
          venue_id: venueId,
          category,
          section: null,
          portions: portionsForMode(servesMode, parseServeCount(serveText)),
          sell_price_inc: null,
          target_override: null,
          hh_price_inc: null,
          active: true,
          source: "app",
          notes: null,
          // a new cocktail or mocktail is offered Research This Drink on its recipe page; everything else never is
          research_status: initialResearchStatus(category),
        };
        const id = await store.insertItem(item, []);
        onClose();
        router.push(`/items/${id}?new=1`);
      } else {
        const prep: Omit<Prep, "id"> = { name: finalName, venue_id: venueId, prep_type: null, yield_qty: 1, yield_unit: "kg", active: true, source: "app", notes: null };
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
        className={onBack ? "space-y-5 pb-2 pt-1" : "space-y-5 pb-2 pt-3"}
      >
        {onBack ? <SheetBack onClick={onBack} /> : null}
        {error ? <Banner>{error}</Banner> : null}
        <input
          autoFocus
          className="field !py-3.5 !text-[20px] font-semibold"
          placeholder={type === "prep" ? "Prep name, e.g. Hollandaise" : "Dish or drink name"}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={nt.onFocus}
          onBlur={nt.onBlur}
          enterKeyHint="done"
          aria-label="Recipe Name"
        />
        <NameSuggestRow nt={nt} className="!mt-2" />
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
          <>
            <div>
              <p className="section-label !px-1">Category{!picked && name.trim() ? <span className="text-label-3"> · guessed from the name</span> : null}</p>
              <Chips ariaLabel="Category" value={category} onChange={setCategory} options={cats.map((c) => ({ value: c, label: c }))} className="flex-wrap [&>button:not([aria-checked=true])]:bg-fill" />
            </div>
            <div>
              <p className="section-label !px-1">Serves</p>
              <ServesSegmented value={servesMode} onChange={(m) => setServesMode(m)} className="w-full" />
              {servesMode === "multiple" ? (
                <div className="group-list mt-2">
                  <FieldRow label="Serves From This Recipe">
                    <input
                      autoFocus
                      inputMode="decimal"
                      aria-label="Serves From This Recipe"
                      value={serveText}
                      onChange={(e) => setServeText(e.target.value)}
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={() => setServeText(String(parseServeCount(serveText) ?? 2))}
                      className="min-h-[36px] w-20 rounded-lg bg-fill px-2.5 text-right text-[17px] text-label tnum outline-none focus:bg-surface-2 focus:shadow-[inset_0_0_0_1.5px_var(--accent-fill)] sm:min-h-[32px] sm:text-[15px]"
                    />
                  </FieldRow>
                </div>
              ) : (
                <p className="px-1 pt-1.5 text-[13px] text-label-2">The ingredients you add make one serve. Choose Multiple Serves for a batch, like a slice tray.</p>
              )}
            </div>
          </>
        ) : (
          <p className="px-1 text-[13px] text-label-2">A prep is a batch recipe (sauce, dough, mix) used inside menu items. It starts as a 1 kg batch; set the yield in the editor.</p>
        )}
        <button type="submit" className="btn-primary w-full" disabled={!canCreate}>
          {busy ? "Creating…" : "Create"}
        </button>
      </form>
    </Sheet>
  );
}
