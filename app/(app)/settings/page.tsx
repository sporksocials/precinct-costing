"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { gp } from "@/lib/format";
import { parsePercentInput } from "@/lib/solver";
import { DEFAULT_TARGET_GP, MENU_CATEGORIES } from "@/lib/types";
import { VENUE_SHORT } from "@/components/venue";
import { Banner, Dot, FieldRow, Group, InlineInput, PageHeader, Row, Sheet, cx } from "@/components/ui";
import { targetGrid } from "@/lib/targets";
import { useDataHealthSummary } from "@/lib/use-data-health";

export default function SettingsPage() {
  const store = useStore();
  const health = useDataHealthSummary();
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);

  const grid = useMemo(
    () => targetGrid(store.venues.map((v) => v.id), MENU_CATEGORIES, store.targets, store.items, store.itemCosts),
    [store.venues, store.targets, store.items, store.itemCosts],
  );

  const run = (p: Promise<void>) => {
    setError(null);
    p.catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  const pctIn = (v: number) => String(Math.round(v * 1000) / 10);
  const pctOut = parsePercentInput;

  return (
    <div className="max-w-2xl">
      <PageHeader title="Settings" />
      {error ? <Banner>{error}</Banner> : null}

      <Group title="Costing" footer="Suggested prices round up to the nearest step. Ingredient moves above the alert level show on Home.">
        <FieldRow label="GST">
          <InlineInput value={pctIn(store.settings.gst_rate)} suffix="%" onCommit={(t) => { const v = pctOut(t); if (v != null) run(store.updateSetting("gst_rate", v)); }} />
        </FieldRow>
        <FieldRow label="Round Prices Up To">
          <InlineInput value={Number(store.settings.round_to).toFixed(2)} prefix="$" onCommit={(t) => { const v = Number(t.replace("$", "")); if (Number.isFinite(v) && v >= 0) run(store.updateSetting("round_to", v)); }} />
        </FieldRow>
        <FieldRow label="Price Alert Above">
          <InlineInput value={pctIn(store.settings.alert_pct)} suffix="%" onCommit={(t) => { const v = pctOut(t); if (v != null) run(store.updateSetting("alert_pct", v)); }} />
        </FieldRow>
      </Group>

      <section className="mt-6">
        <h2 className="section-label">Target GP</h2>
        <div className="group-list">
          <div className="grid grid-cols-[minmax(0,1fr)_repeat(4,3.5rem)] sm:grid-cols-[minmax(0,1fr)_repeat(4,5rem)] items-end gap-x-1 px-3.5 pb-1.5 pt-2.5">
            <span />
            {store.venues.map((v) => (
              <span key={v.id} className={cx("v-" + v.slug, "flex items-center justify-center gap-1 text-[12px] font-semibold text-label-2")}>
                <Dot className="bg-accent-fill" />
                {VENUE_SHORT[v.slug] ?? v.name}
              </span>
            ))}
          </div>
          {grid.map((cells, r) => {
            const cat = MENU_CATEGORIES[r];
            return (
              <div key={cat} className="grid grid-cols-[minmax(0,1fr)_repeat(4,3.5rem)] sm:grid-cols-[minmax(0,1fr)_repeat(4,5rem)] items-start gap-x-1 px-3.5 py-2">
                <span className="min-w-0 pt-1.5">
                  <span className="block text-[15px] leading-tight">{cat}</span>
                </span>
                {cells.map((c) => (
                  <span key={c.venueId} className={cx("flex flex-col items-center", c.items === 0 && "opacity-50")}>
                    <InlineInput
                      value={c.target != null ? pctIn(c.target) : ""}
                      placeholder={pctIn(DEFAULT_TARGET_GP)}
                      suffix="%"
                      width="w-14 sm:w-[4.5rem]"
                      onCommit={(txt) => {
                        const v = pctOut(txt);
                        if (v != null) run(store.upsertTarget(c.venueId, cat, v));
                      }}
                    />
                    <span className={cx("mt-0.5 text-[11px] leading-none", c.under > 0 ? "text-danger" : "text-label-3")}>
                      {c.under > 0 ? `${c.under} under` : c.items > 0 ? `${c.items} items` : "\u00a0"}
                    </span>
                  </span>
                ))}
              </div>
            );
          })}
        </div>
        <p className="px-4 pt-1.5 text-[13px] text-label-2">Blank uses {gp(DEFAULT_TARGET_GP, 0)}. “Under” counts menu items priced below their target now. A recipe can override its own target under Details.</p>
      </section>

      <Group title="Data Health" footer="Checks costs, prices and recipes for anything that could make a number wrong.">
        <Row
          href="/data-health"
          title="Data Health"
          sub={health.ready ? (health.attention ? `${health.errors} ${health.errors === 1 ? "error" : "errors"}, ${health.warnings} ${health.warnings === 1 ? "warning" : "warnings"}` : "All checks passed") : "Checking"}
          trailing={health.ready ? <span className={health.errors ? "text-danger" : health.attention ? "text-warn" : "text-good"}>{health.attention ? `${health.attention} to check` : "All clear"}</span> : undefined}
          chevron
        />
      </Group>

      <Group title="Who Can Sign In" footer="Only these emails can sign in and see prices.">
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
        <Row onClick={() => void store.signOut()} title={<span className="text-danger">Sign Out</span>} />
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
