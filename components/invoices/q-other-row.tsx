"use client";

import { Check } from "lucide-react";
import { describeOption, needsPackHelper, packsAnswer, reviewLineText, type Decision, type OptionLookups, type QuestionBundle } from "@/lib/invoice-questions-view";
import { TouchButton } from "@/components/ordering/touch";
import { cx } from "@/components/ui";
import { PackHelper } from "./q-packs";

/**
 * Every question on the invoice that is not "which ingredient is this line?": a pack size, a big price change, totals that do not
 * add up, a supplier. The answers are buttons you tap to choose (tap again to change your mind); like the match rows, nothing is
 * sent until Save Matches. The invoice-wide ones come first in the review because the matches can depend on them.
 */
export function OtherRow({
  bundle,
  look,
  decision,
  problem,
  disabled,
  onDecide,
}: {
  bundle: QuestionBundle;
  look: OptionLookups;
  decision: Decision | undefined;
  problem: string | null;
  disabled: boolean;
  onDecide: (d: Decision | null) => void;
}) {
  const { q, line } = bundle;
  const text = line ? reviewLineText(line) : null;
  const chosenId = decision?.t === "option" ? decision.optionId : null;
  return (
    <li className="px-4 py-4" aria-label={q.prompt}>
      <p className="text-[17px] font-semibold leading-snug">{q.prompt}</p>
      {text ? (
        <p className="mt-1 break-words text-[13px] leading-snug text-label-2 tnum">{[text.title, text.code ? `Code ${text.code}` : null, text.meta].filter(Boolean).join(" · ")}</p>
      ) : null}

      {needsPackHelper(q.kind) ? (
        <div className="mt-3">
          <PackHelper
            unit={line?.unit}
            disabled={disabled}
            onSave={(n) => {
              const a = packsAnswer(n);
              onDecide({ t: "option", optionId: a.optionId, note: a.note, label: `${n} in each` });
            }}
          />
          {chosenId === "custom:packs" && decision?.t === "option" ? <p className="mt-1.5 px-1 text-[15px] font-semibold text-good">Chosen: {decision.label}</p> : null}
        </div>
      ) : null}

      {q.options.length ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap" role="group" aria-label="Answers">
          {q.options.map((o) => {
            const v = describeOption(o, look, line?.unit);
            const on = chosenId === o.id;
            return (
              <button
                key={o.id}
                type="button"
                disabled={disabled}
                aria-pressed={on}
                onClick={() => onDecide(on ? null : { t: "option", optionId: o.id, label: v.label })}
                className={cx(
                  "flex min-h-[48px] items-center gap-2 rounded-xl px-4 py-2 text-left text-[17px] font-semibold transition active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50",
                  on ? "bg-accent-fill text-accent-on" : "bg-fill text-label",
                )}
              >
                {on ? <Check className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden /> : null}
                <span className="min-w-0">
                  {v.label}
                  {v.sub ? <span className="mt-0.5 block text-[13px] font-normal leading-snug opacity-80">{v.sub}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {decision ? (
        <div className="mt-2">
          <TouchButton variant="text" disabled={disabled} onClick={() => onDecide(null)}>
            Clear My Choice
          </TouchButton>
        </div>
      ) : null}

      {problem ? (
        <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-[15px] text-danger">
          {problem}
        </p>
      ) : null}
    </li>
  );
}
