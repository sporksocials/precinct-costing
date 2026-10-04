"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { gp, parseDecimal } from "@/lib/format";
import { parsePercentInput } from "@/lib/solver";
import { DEFAULT_TARGET_GP, MENU_CATEGORIES } from "@/lib/types";
import { VENUE_SHORT } from "@/components/venue";
import { Banner, Dot, FieldRow, Group, InlineInput, PageHeader, Row, Sheet, cx } from "@/components/ui";
import { targetGrid } from "@/lib/targets";
import { formatVerifiedTime } from "@/lib/health";
import { useDataHealthSummary } from "@/lib/use-data-health";
import { cleanName, isOwnerEmail, NAME_MAX } from "@/lib/people";
import type { AllowedUser } from "@/lib/types";

export default function SettingsPage() {
  const store = useStore();
  const health = useDataHealthSummary();
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const owner = isOwnerEmail(store.userEmail);

  const grid = useMemo(
    () => targetGrid(store.venues.map((v) => v.id), MENU_CATEGORIES, store.targets, store.items, store.itemCosts),
    [store.venues, store.targets, store.items, store.itemCosts],
  );

  const run = (p: Promise<void>) => {
    setError(null);
    p.catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  const verifiedAt = formatVerifiedTime(store.health.lastVerifiedAt);
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
          <InlineInput value={Number(store.settings.round_to).toFixed(2)} prefix="$" onCommit={(t) => { const v = parseDecimal(t); if (v != null) run(store.updateSetting("round_to", v)); }} />
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

      <Group title="Who Can Sign In" footer={owner ? "Only these emails can sign in and see prices. Tap a name box to change it, then tap away or press Enter to save. Names show in the change log, price history and ignored alerts instead of the email. Only you can set them." : "Only these emails can sign in and see prices. Names show in the change log, price history and ignored alerts."}>
        {store.allowedUsers.map((u) => (
          <PersonRow key={u.email} user={u} you={!!store.userEmail && u.email.toLowerCase() === store.userEmail.toLowerCase()} canName={owner} onName={(n) => run(store.setAllowedUserName(u.email, n))} onRemove={() => setRemoving(u.email)} />
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

      <p className="mt-6 px-4 text-center text-[13px] text-label-3">
        {verifiedAt && (store.health.state === "ok" || store.health.state === "repaired") ? `Data Verified ${verifiedAt}` : "Data Not Verified"}
      </p>

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


/** One person on the sign-in list: their first name (only the owner can edit it) over their email, and Remove. */
function PersonRow({ user, you, canName, onName, onRemove }: { user: AllowedUser; you: boolean; canName: boolean; onName: (name: string | null) => void; onRemove: () => void }) {
  const saved = cleanName(user.display_name) ?? "";
  const [text, setText] = useState(saved);
  useEffect(() => setText(saved), [saved]);
  const commit = () => {
    const next = cleanName(text) ?? "";
    setText(next);
    if (next !== saved) onName(next || null);
  };
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        {canName ? (
          <input
            className="field block !h-11 w-full min-w-0 !py-0 sm:!h-9"
            placeholder="First name"
            aria-label={`First name for ${user.email}`}
            value={text}
            maxLength={NAME_MAX}
            enterKeyHint="done"
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        ) : (
          <p className="text-[17px] sm:text-[15px]">{saved || user.email}</p>
        )}
        <p className={cx("break-all text-[13px] text-label-2", canName && "mt-1")}>
          {canName || saved ? user.email : ""}
          {you ? `${canName || saved ? " · " : ""}You` : ""}
        </p>
      </div>
      <button type="button" className="shrink-0 text-[15px] text-danger" onClick={onRemove}>
        Remove
      </button>
    </div>
  );
}
