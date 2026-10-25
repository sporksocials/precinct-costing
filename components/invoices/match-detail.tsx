"use client";

import { useId, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { collapsedSentence, packWords } from "@/lib/invoice-conversion";
import type { RowDetail } from "@/lib/invoice-todo-match";
import { cx } from "@/components/ui";
import { TouchButton } from "@/components/ordering/touch";

/**
 * What a matched item shows under its picker: how much ONE invoice unit is in the app's packs, with the price per kg, per L or
 * per each beside the app's (so a PKT of 2.5 kg against a 1 kg pack is seen at once), and the name the ingredient will take
 * from the invoice. Two quiet lines until the person edits. Nothing here saves; Save Matches does.
 */
export function MatchDetail({
  detail,
  disabled,
  onPacks,
  onName,
  onKeep,
}: {
  detail: RowDetail;
  disabled: boolean;
  onPacks: (text: string) => void;
  onName: (text: string) => void;
  onKeep: (keep: boolean) => void;
}) {
  return (
    <div className="mt-3 space-y-3 rounded-xl bg-surface-2 px-3.5 py-3.5">
      <Conversion detail={detail} disabled={disabled} onPacks={onPacks} />
      <NameBlock detail={detail} disabled={disabled} onName={onName} onKeep={onKeep} />
    </div>
  );
}

const FIELD = "min-h-[44px] rounded-xl bg-fill px-3 text-[17px] text-label outline-none transition-shadow placeholder:text-label-3 focus:bg-surface focus:shadow-[inset_0_0_0_1.5px_var(--accent-fill)] disabled:opacity-50";

function Conversion({ detail, disabled, onPacks }: { detail: RowDetail; disabled: boolean; onPacks: (text: string) => void }) {
  const v = detail.conversion;
  const id = useId();
  const [open, setOpen] = useState(false);
  const asking = v.packs == null;

  if (v.collapsed && !open) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
        <p className="flex items-center gap-1.5 text-[15px] text-label-2">
          <CheckCircle2 aria-hidden className="h-[18px] w-[18px] shrink-0 text-good" strokeWidth={2.25} />
          {collapsedSentence(v)}
        </p>
        <button type="button" disabled={disabled} onClick={() => setOpen(true)} className="inline-flex min-h-[44px] items-center px-1 text-[15px] font-medium text-accent disabled:opacity-40">
          Change Pack Size
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <label htmlFor={id} className="text-[15px] font-medium text-label">
          1 {v.unitLabel} =
        </label>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          disabled={disabled}
          value={v.boxText}
          placeholder="How many"
          aria-invalid={v.invalid || asking ? true : undefined}
          aria-label={`Packs in one ${v.unitLabel}`}
          onChange={(e) => onPacks(e.target.value)}
          className={cx(FIELD, "w-[104px] text-center tnum", (v.invalid || asking) && "shadow-[inset_0_0_0_1.5px_var(--warn)]")}
        />
        <span className="text-[15px] text-label-2">x {packWords(detail.ingredient)}</span>
      </div>

      {asking ? (
        <div className="mt-1.5">
          <p role="alert" className="flex items-start gap-1.5 text-[15px] font-medium leading-snug text-warn">
            <AlertTriangle aria-hidden className="mt-0.5 h-[18px] w-[18px] shrink-0" strokeWidth={2.5} />
            <span>{v.invalid ? v.blocker : `Tell the app how much one ${v.unitLabel} is.`}</span>
          </p>
          {v.derivation.hint ? <p className="mt-0.5 pl-6 text-[13px] leading-snug text-label-2">{v.derivation.hint}</p> : null}
          {v.quick.length ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-0">
              <span className="text-[13px] text-label-2">Packs in one {v.unitLabel}:</span>
              {v.quick.map((n) => (
                <TouchButton key={n} variant="tinted" disabled={disabled} className="!px-3 !text-[15px] tnum" aria-label={`${n} packs in one ${v.unitLabel}`} onClick={() => onPacks(String(n))}>
                  {n}
                </TouchButton>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-1.5 space-y-1">
          {v.sentence ? <p className="text-[15px] leading-snug text-label-2 tnum">{v.sentence}</p> : null}
          {v.derivation.sizeText && v.derivation.how === "described" && v.derivation.unitSize ? (
            <p className="text-[13px] leading-snug text-label-2">
              The invoice describes it as {v.derivation.sizeText}
              {v.derivation.sizeText.includes(" x ") ? `, which is ${trim(v.derivation.unitSize.amount)} ${unitWord(v.derivation.unitSize.dim)}` : ""}.
            </p>
          ) : null}
          {v.note ? (
            <p role="note" className="flex items-start gap-1.5 rounded-lg bg-warn-soft px-2.5 py-1.5 text-[15px] font-medium leading-snug text-warn">
              <AlertTriangle aria-hidden className="mt-0.5 h-[18px] w-[18px] shrink-0" strokeWidth={2.5} />
              <span>{v.note}</span>
            </p>
          ) : v.comparison?.state === "match" ? (
            <p className="flex items-center gap-1.5 text-[15px] font-medium text-good">
              <CheckCircle2 aria-hidden className="h-[18px] w-[18px] shrink-0" strokeWidth={2.25} />
              Matches the app
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

const trim = (n: number) => String(Math.round(n * 10000) / 10000);
const unitWord = (d: "kg" | "L" | "each") => (d === "each" ? "each" : d);

function NameBlock({ detail, disabled, onName, onKeep }: { detail: RowDetail; disabled: boolean; onName: (text: string) => void; onKeep: (keep: boolean) => void }) {
  const n = detail.name;
  const id = useId();
  if (n.kind === "same") {
    return <p className="text-[15px] text-label-2">The app already calls this {n.current}.</p>;
  }
  return (
    <div>
      {n.keep ? (
        <p className="text-[15px] leading-snug text-label-2">
          The app name stays <span className="font-medium text-label">{n.current}</span>.
          {n.note ? <span className="block text-[13px]">{n.note}</span> : null}
        </p>
      ) : (
        <div>
          <label htmlFor={id} className="text-[13px] font-medium text-label-2">
            App name will become
          </label>
          <input
            id={id}
            type="text"
            autoComplete="off"
            maxLength={120}
            disabled={disabled}
            value={n.text}
            onChange={(e) => onName(e.target.value)}
            aria-invalid={n.problem ? true : undefined}
            className={cx(FIELD, "mt-1 w-full", n.problem && "shadow-[inset_0_0_0_1.5px_var(--warn)]")}
          />
          <p className="mt-1 text-[13px] leading-snug text-label-2">
            Now called <span className="font-medium">{n.current}</span>.
          </p>
          {n.problem ? (
            <p role="alert" className="mt-1 flex items-start gap-1.5 text-[15px] font-medium leading-snug text-warn">
              <AlertTriangle aria-hidden className="mt-0.5 h-[18px] w-[18px] shrink-0" strokeWidth={2.5} />
              <span>{n.problem} Its name will stay as it is.</span>
            </p>
          ) : null}
        </div>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={n.keep}
        disabled={disabled}
        onClick={() => onKeep(!n.keep)}
        className="mt-1 flex min-h-[44px] w-full items-center justify-between gap-3 text-left text-[15px] font-medium text-label disabled:opacity-50"
      >
        <span>Keep Current Name</span>
        <span aria-hidden className={cx("relative inline-flex h-[31px] w-[51px] shrink-0 items-center rounded-full transition-colors duration-200", n.keep ? "bg-accent-fill" : "bg-fill-2")}>
          <span className={cx("inline-block h-[27px] w-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.16)] transition-transform duration-200", n.keep ? "translate-x-[22px]" : "translate-x-[2px]")} />
        </span>
      </button>
    </div>
  );
}
