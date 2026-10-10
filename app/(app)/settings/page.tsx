"use client";

import { useMemo, useState } from "react";
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
import { CROSS_CONTACT_MAX, DEFAULT_CROSS_CONTACT, crossContactFromSettings, crossContactSettingKey } from "@/lib/allergy-matrix";

export default function SettingsPage() {
  const store = useStore();
  const health = useDataHealthSummary();
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [nameText, setNameText] = useState("");
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

      <section className="mt-6">
        <h2 className="section-label">Allergy Matrix Cross-Contact Line</h2>
        <div className="group-list">
          {store.venues.map((v) => (
            <CrossContactRow
              key={`${v.id}:${crossContactFromSettings(store.rawSettings, v.slug) ?? ""}`}
              label={VENUE_SHORT[v.slug] ?? v.name}
              saved={crossContactFromSettings(store.rawSettings, v.slug) ?? ""}
              onSave={(t) => store.updateTextSetting(crossContactSettingKey(v.slug), t)}
              onError={(m) => setError(m)}
            />
          ))}
        </div>
        <p className="px-4 pt-1.5 text-[13px] text-label-2">One short line per venue, printed in the footer of every Allergy Matrix sheet and shown on the kitchen iPad. Leave it blank to use: “{DEFAULT_CROSS_CONTACT}”</p>
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

      <Group title="Who Can Sign In" footer={owner ? "Only these emails can sign in and see prices. Tap Edit beside a person to give them a first name. Names show in the change log, price history and ignored alerts instead of the email. Only you can set them." : "Only these emails can sign in and see prices. Names show in the change log, price history and ignored alerts."}>
        {store.allowedUsers.map((u) => (
          <PersonRow
            key={u.email}
            user={u}
            you={!!store.userEmail && u.email.toLowerCase() === store.userEmail.toLowerCase()}
            canName={owner}
            onEdit={() => {
              setNameText(cleanName(u.display_name) ?? "");
              setNaming(u.email);
            }}
            onRemove={() => setRemoving(u.email)}
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

      <p className="mt-6 px-4 text-center text-[13px] text-label-3">
        {verifiedAt && (store.health.state === "ok" || store.health.state === "repaired") ? `Data Verified ${verifiedAt}` : "Data Not Verified"}
      </p>

      <Sheet open={!!naming} onClose={() => setNaming(null)} hideHeader size="sm">
        <form
          className="pb-2 pt-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (naming) run(store.setAllowedUserName(naming, nameText));
            setNaming(null);
          }}
        >
          <p className="text-center text-[20px] font-semibold">First Name</p>
          <p className="mt-1.5 break-all text-center text-[15px] text-label-2">{naming}</p>
          <input
            className="field mt-4 w-full"
            placeholder="First name"
            aria-label="First name"
            autoFocus
            maxLength={NAME_MAX}
            value={nameText}
            onChange={(e) => setNameText(e.target.value)}
          />
          <p className="mt-2 text-[13px] text-label-2">Shown in the change log, price history and ignored alerts instead of the email.</p>
          <div className="mt-5 space-y-2">
            <button type="submit" className="btn-primary w-full">
              Save
            </button>
            {nameText.trim() ? (
              <button type="button" className="btn-plain w-full" onClick={() => setNameText("")}>
                Clear Name
              </button>
            ) : null}
            <button type="button" className="btn-plain w-full" onClick={() => setNaming(null)}>
              Cancel
            </button>
          </div>
        </form>
      </Sheet>

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


/** One venue's cross-contact line: saves when the field is left (like the other settings), with one quiet "Saved" line. */
function CrossContactRow({ label, saved, onSave, onError }: { label: string; saved: string; onSave: (text: string) => Promise<void>; onError: (message: string) => void }) {
  const [text, setText] = useState(saved);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const commit = () => {
    if (text.trim().replace(/\s+/g, " ") === saved) return;
    setState("saving");
    onSave(text).then(
      () => setState("saved"),
      (e) => {
        setState("idle");
        onError(e instanceof Error ? e.message : String(e));
      },
    );
  };
  return (
    <div className="px-4 py-3">
      <label className="block">
        <span className="block pb-1 text-[17px] font-medium sm:text-[15px]">{label}</span>
        <textarea
          rows={2}
          className="field resize-none"
          maxLength={CROSS_CONTACT_MAX}
          placeholder={DEFAULT_CROSS_CONTACT}
          aria-label={`${label} cross-contact line`}
          value={text}
          onChange={(e) => {
            setText(e.target.value.replace(/\n/g, " "));
            setState("idle");
          }}
          onBlur={commit}
        />
      </label>
      <p className="mt-1 min-h-[18px] text-[13px] text-label-2" aria-live="polite">
        {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : text.trim() ? "" : "Using the standard line"}
      </p>
    </div>
  );
}

/** One person on the sign-in list: their first name (or "No name set") over their email, an Edit button for the owner, and Remove. */
function PersonRow({ user, you, canName, onEdit, onRemove }: { user: AllowedUser; you: boolean; canName: boolean; onEdit: () => void; onRemove: () => void }) {
  const saved = cleanName(user.display_name);
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        {saved ? (
          <p className="text-[17px] sm:text-[15px]">{saved}</p>
        ) : canName ? (
          <p className="text-[17px] text-label-3 sm:text-[15px]">No name set</p>
        ) : (
          <p className="break-all text-[17px] sm:text-[15px]">{user.email}</p>
        )}
        <p className="break-all text-[13px] text-label-2">
          {saved || canName ? user.email : ""}
          {you ? `${saved || canName ? " · " : ""}You` : ""}
        </p>
      </div>
      {canName ? (
        <button type="button" className="btn-tinted !min-h-[44px] shrink-0 !px-4 !text-[15px] sm:!min-h-[34px] sm:!text-[14px]" onClick={onEdit} aria-label={`Edit name for ${user.email}`}>
          Edit
        </button>
      ) : null}
      <button type="button" className="shrink-0 text-[15px] text-danger" onClick={onRemove}>
        Remove
      </button>
    </div>
  );
}
