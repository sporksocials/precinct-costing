"use client";

import { useEffect, useRef } from "react";
import { Banner, Sheet } from "../ui";
import type { ConflictItemView } from "@/lib/conflict-view";

/**
 * "Changed While You Were Editing": shown when Save finds that someone else changed the same dish, drink or prep and the
 * two edits clash. Nothing has been written yet. Each clash is listed with Yours and Theirs (stacked on phones, side by
 * side from 640px up), and each button says what it will do, with the resulting cost, before anyone taps it.
 */
export function ConflictSheet({
  open,
  intro,
  alsoChanged,
  items,
  impact,
  consequences,
  busy,
  error,
  onChoose,
  onCancel,
}: {
  open: boolean;
  intro: string;
  /** what else they changed that is NOT a clash (kept either way); empty for none */
  alsoChanged: string;
  items: ConflictItemView[];
  impact: { mine: string; theirs: string };
  consequences: { keepMine: string; useTheirs: string; cancel: string };
  busy: boolean;
  error: string | null;
  onChoose: (choice: "mine" | "theirs") => void;
  onCancel: () => void;
}) {
  // keyboard and screen reader users land on the safe choice; preventScroll keeps the heading in view on a phone
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => cancelRef.current?.focus({ preventScroll: true }), 50);
    return () => window.clearTimeout(t);
  }, [open]);
  return (
    <Sheet open={open} onClose={() => (busy ? undefined : onCancel())} hideHeader size="lg" labelledBy="conflict-title">
      <div className="pb-2 pt-4" aria-busy={busy}>
        <h2 id="conflict-title" className="text-center text-[20px] font-semibold">
          Changed While You Were Editing
        </h2>
        <p className="mx-auto mt-1.5 max-w-md text-center text-[15px] text-label-2">{intro}</p>
        {error ? <Banner>{error}</Banner> : null}

        <ul className="mt-4 space-y-3" aria-labelledby="conflict-title">
          {items.map((it) => (
            <li key={it.id} className="rounded-2xl bg-fill p-3.5">
              <p className="text-[17px] font-semibold leading-snug sm:text-[15px]">{it.heading}</p>
              <p className="text-[13px] text-label-2">{it.note}</p>
              <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                <Side label="Yours" lines={it.mine} />
                <Side label="Theirs" lines={it.theirs} />
              </div>
            </li>
          ))}
        </ul>
        {alsoChanged ? <p className="mt-3 text-[13px] leading-snug text-label-3">Also changed by them and kept either way: {alsoChanged}</p> : null}

        <div className="mt-5 space-y-3">
          <Choice
            primary
            label="Keep Mine"
            disabled={busy}
            busyLabel={busy ? "Saving…" : null}
            onClick={() => onChoose("mine")}
            what={consequences.keepMine}
            result={impact.mine}
          />
          <Choice tinted label="Use Theirs" disabled={busy} onClick={() => onChoose("theirs")} what={consequences.useTheirs} result={impact.theirs} />
          <Choice plain buttonRef={cancelRef} label="Cancel" disabled={busy} onClick={onCancel} what={consequences.cancel} />
        </div>
      </div>
    </Sheet>
  );
}

function Side({ label, lines }: { label: string; lines: string[] }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface px-3 py-2">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-label-3">{label}</p>
      <div className="mt-0.5 space-y-0.5 break-words text-[15px] leading-snug">
        {lines.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </div>
    </div>
  );
}

function Choice({
  label,
  what,
  result,
  onClick,
  disabled,
  primary,
  plain,
  tinted,
  buttonRef,
  busyLabel,
}: {
  label: string;
  what: string;
  result?: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  plain?: boolean;
  tinted?: boolean;
  buttonRef?: React.Ref<HTMLButtonElement>;
  busyLabel?: string | null;
}) {
  const id = `conflict-${label.toLowerCase().replace(/\s+/g, "-")}-what`;
  return (
    <div>
      <button type="button" ref={buttonRef} aria-describedby={id} className={primary ? "btn-primary w-full" : tinted ? "btn-tinted w-full" : plain ? "btn-plain w-full" : "btn w-full"} disabled={disabled} onClick={onClick}>
        {busyLabel ?? label}
      </button>
      <p id={id} className="mx-auto mt-1 max-w-md text-center text-[13px] leading-snug text-label-2">
        {what}
        {result ? <span className="block text-label-3">{result}</span> : null}
      </p>
    </div>
  );
}
