"use client";

import { Ban, CheckCircle2, CircleHelp, Plus, Sparkles } from "lucide-react";
import { reviewLineText, rowStatus, STATUS_WORDS, type Decision, type IngredientDoc, type IngredientLite, type QuestionBundle, type RowStatus, type RowSuggestion } from "@/lib/invoice-questions-view";
import { TouchButton } from "@/components/ordering/touch";
import { cx } from "@/components/ui";
import { LinePicker } from "./q-picker";

const STATUS_ICON: Record<RowStatus, { Icon: typeof CheckCircle2; tone: string }> = {
  matched: { Icon: CheckCircle2, tone: "text-good" },
  not_in_app: { Icon: Ban, tone: "text-label-2" },
  suggested: { Icon: Sparkles, tone: "text-accent" },
  needs_choice: { Icon: CircleHelp, tone: "text-warn" },
};

/** A status as a word with an icon, so no colour has to carry the meaning on its own. */
export function StatusWord({ status }: { status: RowStatus }) {
  const { Icon, tone } = STATUS_ICON[status];
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-[15px] font-semibold", tone)}>
      <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2.25} aria-hidden />
      {STATUS_WORDS[status]}
    </span>
  );
}

/**
 * One invoice line to match. Wide screens lay it out as a table row (line, "In The App As", status and actions); a phone stacks
 * the same three parts. A suggestion is only a suggestion: it waits for "Use Suggestion" (or Accept All Suggestions) and the row
 * counts as chosen only once a person has chosen. Nothing here saves anything; the review's Save Matches does.
 */
export function MatchRow({
  bundle,
  decision,
  suggestion,
  suggestedIngredient,
  chosenIngredient,
  candidates,
  docs,
  problem,
  disabled,
  onDecide,
  onAddNew,
}: {
  bundle: QuestionBundle;
  decision: Decision | undefined;
  suggestion: RowSuggestion | null;
  /** the ingredient the suggestion names, when it is still in the app */
  suggestedIngredient: IngredientLite | null;
  /** the ingredient the person chose, when it is in the app's list */
  chosenIngredient: IngredientLite | null;
  candidates: readonly IngredientLite[];
  docs: readonly IngredientDoc[];
  problem: string | null;
  disabled: boolean;
  onDecide: (d: Decision | null) => void;
  onAddNew: () => void;
}) {
  const text = reviewLineText(bundle.line);
  const usable = suggestion && suggestedIngredient ? suggestion : null;
  const status = rowStatus(decision, usable);
  const shown = decision?.t === "ingredient" ? chosenIngredient : decision ? null : usable ? suggestedIngredient : null;
  const tag = decision?.t === "ingredient" ? (decision.via === "new" ? "New" : "Matched") : !decision && usable ? "Suggested" : null;

  return (
    <li className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.2fr)] lg:gap-5" aria-label={text.title}>
      <div className="min-w-0">
        <p className="break-words text-[17px] font-semibold leading-snug">{text.title}</p>
        <p className="mt-0.5 break-words text-[13px] leading-snug text-label-2 tnum">{[text.code ? `Code ${text.code}` : null, text.meta].filter(Boolean).join(" · ")}</p>
      </div>

      <div className="min-w-0">
        {decision?.t === "none" ? (
          <div className="flex min-h-[56px] items-center rounded-xl bg-fill px-4 py-2 text-[17px] font-semibold text-label-2">Not In The App</div>
        ) : (
          <LinePicker
            shown={shown}
            tag={tag}
            candidates={candidates}
            docs={docs}
            label={text.title}
            disabled={disabled}
            onPick={(ing) => onDecide({ t: "ingredient", ingredientId: ing.id, name: ing.name, via: "pick" })}
          />
        )}
        {!decision && usable?.source === "ai" && usable.reason ? <p className="mt-1.5 px-1 text-[13px] leading-snug text-label-2">{usable.reason}</p> : null}
      </div>

      <div className="min-w-0">
        <StatusWord status={status} />
        <div className="mt-2 flex flex-wrap gap-2">
          {!decision && usable && suggestedIngredient ? (
            <TouchButton variant="primary" className="!px-3 !text-[15px]" disabled={disabled} onClick={() => onDecide({ t: "ingredient", ingredientId: suggestedIngredient.id, name: suggestedIngredient.name, via: "suggestion" })}>
              Use Suggestion
            </TouchButton>
          ) : null}
          {decision ? (
            <TouchButton variant="plain" className="!px-3 !text-[15px]" disabled={disabled} onClick={() => onDecide(null)}>
              Clear
            </TouchButton>
          ) : null}
          {decision?.t !== "none" ? (
            <TouchButton variant="plain" className="!px-3 !text-[15px]" disabled={disabled} onClick={() => onDecide({ t: "none" })}>
              Not In The App
            </TouchButton>
          ) : null}
          {decision?.t !== "ingredient" || decision.via !== "new" ? (
            <TouchButton variant="tinted" className="!px-3 !text-[15px]" disabled={disabled} onClick={onAddNew}>
              <Plus className="h-5 w-5" strokeWidth={2.25} aria-hidden />
              Add As New Ingredient
            </TouchButton>
          ) : null}
        </div>
      </div>

      {problem ? (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-[15px] text-danger lg:col-span-3">
          {problem}
        </p>
      ) : null}
    </li>
  );
}
