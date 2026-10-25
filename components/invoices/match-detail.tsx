"use client";

import { useEffect, useId, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { amountWords, collapsedSentence, packWords, splitProduct } from "@/lib/invoice-conversion";
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
  const [work, setWork] = useState(false);
  const asking = v.packs == null;
  const unitWordText = v.base === "each" ? "items" : v.base;
  const split = splitProduct(v.boxText);
  const [count, setCount] = useState(split?.[0] ?? "");
  const [size, setSize] = useState(split?.[1] ?? "");

  // the breakdown fields follow the main box when it is typed in directly or a quick amount is tapped
  useEffect(() => {
    if (split) {
      setCount(split[0]);
      setSize(split[1]);
    } else if (v.boxText !== "") {
      setCount("");
      setSize("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.boxText]);

  const writeParts = (c: string, s: string) => {
    setCount(c);
    setSize(s);
    if (c.trim() && s.trim()) onPacks(`${c.trim()} x ${s.trim()}`);
    else if (split) onPacks("");
  };
  const showWork = work || split != null || (asking && !v.invalid);

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
          1 {v.unitLabel} holds
        </label>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          disabled={disabled}
          value={v.boxText}
          placeholder="e.g. 12"
          aria-invalid={v.invalid || asking ? true : undefined}
          aria-label={`${unitWordText} in one ${v.unitLabel}`}
          onChange={(e) => onPacks(e.target.value)}
          className={cx(FIELD, "w-[112px] text-center tnum", (v.invalid || asking) && "shadow-[inset_0_0_0_1.5px_var(--warn)]")}
        />
        <span className="text-[15px] font-medium text-label">{unitWordText}</span>
        {split && v.amount != null ? <span className="text-[15px] text-label-2 tnum">= {amountWords(v.amount, v.base)}</span> : null}
      </div>

      {showWork ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="text-[13px] text-label-2">Or work it out:</span>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            disabled={disabled}
            value={count}
            placeholder="6"
            aria-label={`How many packs or bags in one ${v.unitLabel}`}
            onChange={(e) => writeParts(e.target.value, size)}
            className={cx(FIELD, "w-[72px] text-center tnum")}
          />
          <span aria-hidden className="text-[15px] text-label-2">
            x
          </span>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            disabled={disabled}
            value={size}
            placeholder="2"
            aria-label={`${unitWordText} in each pack or bag`}
            onChange={(e) => writeParts(count, e.target.value)}
            className={cx(FIELD, "w-[72px] text-center tnum")}
          />
          <span className="text-[13px] text-label-2">{unitWordText} each</span>
        </div>
      ) : (
        <button type="button" disabled={disabled} onClick={() => setWork(true)} className="mt-0.5 inline-flex min-h-[44px] items-center px-0.5 text-[15px] font-medium text-accent disabled:opacity-40">
          Work It Out From Packs
        </button>
      )}

      {asking ? (
        <div className="mt-1.5">
          <p role="alert" className="flex items-start gap-1.5 text-[15px] font-medium leading-snug text-warn">
            <AlertTriangle aria-hidden className="mt-0.5 h-[18px] w-[18px] shrink-0" strokeWidth={2.5} />
            <span>{v.blocker}</span>
          </p>
          {v.derivation.hint ? <p className="mt-0.5 pl-6 text-[13px] leading-snug text-label-2">{v.derivation.hint}</p> : null}
          {v.quick.length ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-0">
              <span className="text-[13px] text-label-2">Could it be:</span>
              {v.quick.map((n) => (
                <TouchButton key={n} variant="tinted" disabled={disabled} className="!px-3 !text-[15px] tnum" aria-label={`${amountWords(n, v.base)} in one ${v.unitLabel}`} onClick={() => onPacks(String(n))}>
                  {amountWords(n, v.base)}
                </TouchButton>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-1.5 space-y-1">
          {v.sentence ? <p className="text-[15px] leading-snug text-label-2 tnum">{v.sentence}</p> : null}
          <p className="text-[13px] leading-snug text-label-2 tnum">{packsLine(v.packs!, detail)}</p>
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

/** "That is 1 of the app's 12 kg packs." / "That is 0.2083 of the app's 12 kg packs." */
function packsLine(packs: number, detail: RowDetail): string {
  const pack = packWords(detail.ingredient);
  return packs === 1 ? `That is one whole ${pack} in the app.` : `That is ${trim(packs)} x the app's ${pack}.`;
}
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
