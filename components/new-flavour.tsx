"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { FLAVOUR_PREP_TYPE, flavourName } from "@/lib/gelato";
import { Banner, Sheet } from "@/components/ui";

/** New gelato flavour: a name, then straight into its mix. Used from the Menu and the Price Grid. */
export function NewFlavourSheet({ venueId, onClose }: { venueId: number; onClose: () => void }) {
  const store = useStore();
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = name.trim().replace(/\s+gelato\s+mix$/i, "").trim();
  const exists = !!clean && store.gelato.flavours.some((f) => flavourName(f).toLowerCase() === clean.toLowerCase());

  async function create() {
    if (!clean || exists || busy) return;
    setBusy(true);
    setError(null);
    try {
      const id = await store.insertPrep({ name: `${clean} gelato mix`, venue_id: venueId, prep_type: FLAVOUR_PREP_TYPE, yield_qty: 1, yield_unit: "kg", active: true, source: "app", notes: null });
      onClose();
      router.push(`/preps/${id}?new=1`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title="New Flavour" action={{ label: busy ? "Adding…" : "Add", onClick: () => void create(), disabled: !clean || exists || busy }}>
      <form
        className="space-y-4 pb-2 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        {error ? <Banner>{error}</Banner> : null}
        <input autoFocus className="field !text-[20px] font-semibold" placeholder="Flavour name, e.g. Lemon Sorbet" value={name} onChange={(e) => setName(e.target.value)} aria-label="Flavour Name" />
        {exists ? <p className="px-1 text-[13px] text-danger">There’s already a {clean} flavour.</p> : null}
        <p className="px-1 text-[13px] text-label-2">Next you’ll add the mix ingredients (base, paste, toppings). Every serve is priced from the mix automatically — no recipes to set up.</p>
        <button type="submit" className="btn-primary w-full" disabled={!clean || exists || busy}>
          {busy ? "Adding…" : "Add Flavour"}
        </button>
      </form>
    </Sheet>
  );
}
