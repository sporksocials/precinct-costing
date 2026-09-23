"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { gp } from "@/lib/format";
import { DEFAULT_TARGET_GP, MENU_CATEGORIES } from "@/lib/types";
import { VENUE_SHORT } from "@/components/venue";
import { Banner, FieldRow, Group, InlineInput, PageHeader, Row, Segmented, Sheet } from "@/components/ui";

export default function SettingsPage() {
  const store = useStore();
  const [error, setError] = useState<string | null>(null);
  const [venueId, setVenueId] = useState(String(store.venues[0]?.id ?? 1));
  const [email, setEmail] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);

  const run = (p: Promise<void>) => {
    setError(null);
    p.catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  const pctIn = (v: number) => String(Math.round(v * 1000) / 10);
  const pctOut = (t: string) => {
    const n = Number(t.replace(/[%\s]/g, ""));
    if (!Number.isFinite(n) || t.trim() === "") return null;
    return n > 1 ? n / 100 : n;
  };

  return (
    <div className="max-w-2xl">
      <PageHeader title="Settings" />
      {error ? <Banner>{error}</Banner> : null}

      <Group title="Costing" footer="Suggested prices round up to the nearest step. Ingredient moves above the alert level show on Home.">
        <FieldRow label="GST">
          <InlineInput value={pctIn(store.settings.gst_rate)} suffix="%" onCommit={(t) => { const v = pctOut(t); if (v != null) run(store.updateSetting("gst_rate", v)); }} />
        </FieldRow>
        <FieldRow label="Round prices up to">
          <InlineInput value={String(store.settings.round_to)} prefix="$" onCommit={(t) => { const v = Number(t); if (v >= 0) run(store.updateSetting("round_to", v)); }} />
        </FieldRow>
        <FieldRow label="Price alert above">
          <InlineInput value={pctIn(store.settings.alert_pct)} suffix="%" onCommit={(t) => { const v = pctOut(t); if (v != null) run(store.updateSetting("alert_pct", v)); }} />
        </FieldRow>
      </Group>

      <section className="mt-6">
        <h2 className="section-label">Target GP</h2>
        <Segmented ariaLabel="Venue" value={venueId} onChange={setVenueId} options={store.venues.map((v) => ({ value: String(v.id), label: VENUE_SHORT[v.slug] ?? v.name }))} />
        <div className="group-list mt-2">
          {MENU_CATEGORIES.map((cat) => {
            const t = store.targets.find((x) => x.venue_id === Number(venueId) && x.category === cat);
            return (
              <FieldRow key={cat} label={cat}>
                <InlineInput
                  value={t ? pctIn(Number(t.target_gp)) : ""}
                  placeholder={String(DEFAULT_TARGET_GP * 100)}
                  suffix="%"
                  onCommit={(txt) => {
                    const v = pctOut(txt);
                    if (v != null) run(store.upsertTarget(Number(venueId), cat, v));
                  }}
                />
              </FieldRow>
            );
          })}
        </div>
        <p className="px-4 pt-1.5 text-[13px] text-label-2">Blank uses {gp(DEFAULT_TARGET_GP, 0)}. A recipe can override its own target under Details.</p>
      </section>

      <Group title="Who can sign in" footer="Only these emails can sign in and see prices.">
        {store.allowedUsers.map((u) => (
          <Row
            key={u.email}
            title={u.email}
            sub={store.userEmail && u.email.toLowerCase() === store.userEmail.toLowerCase() ? "You" : undefined}
            trailing={
              <button type="button" className="text-[15px] text-danger" onClick={() => setRemoving(u.email)}>
                Remove
              </button>
            }
          />
        ))}
        <form
          className="flex items-center gap-2 px-4 py-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!email.trim()) return;
            run(store.addAllowedUser(email).then(() => setEmail("")));
          }}
        >
          <input type="email" className="h-11 min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-label-3 sm:text-[15px]" placeholder="Add email address" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="submit" className="btn-text font-semibold" disabled={!email.trim()}>
            Add
          </button>
        </form>
      </Group>

      <Group title="Account">
        <Row title={store.userEmail ?? "—"} />
        <Row onClick={() => void store.signOut()} title={<span className="text-danger">Sign out</span>} />
      </Group>

      <Sheet open={!!removing} onClose={() => setRemoving(null)} hideHeader size="sm">
        <div className="pb-2 pt-5 text-center">
          <p className="text-[20px] font-semibold">Remove access?</p>
          <p className="mt-1.5 text-[15px] text-label-2">
            {removing} won’t be able to sign in.
            {removing && store.userEmail && removing.toLowerCase() === store.userEmail.toLowerCase() ? " That’s you — you’ll be locked out." : ""}
          </p>
          <div className="mt-5 space-y-2">
            <button
              className="btn w-full bg-danger-soft text-danger"
              onClick={() => {
                if (removing) run(store.removeAllowedUser(removing));
                setRemoving(null);
              }}
            >
              Remove
            </button>
            <button className="btn-plain w-full" onClick={() => setRemoving(null)}>
              Cancel
            </button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
