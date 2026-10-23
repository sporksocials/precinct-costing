"use client";

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canSearchIngredients, describeOption, ingredientAnswer, isMatchOption, lineText, needsPackHelper, packsAnswer, type IngredientDoc, type IngredientLite, type OptionLookups, type OptionVariant, type QuestionBundle } from "@/lib/invoice-questions-view";
import type { QuestionOption } from "@/lib/invoice-types";
import { cx } from "@/components/ui";
import { PdfLink } from "./q-pdf-link";
import { IngredientPicker } from "./q-search";
import { PackHelper } from "./q-packs";

/** What the card hands to the screen when a person answers. */
export interface AnswerChoice {
  optionId: string;
  note?: string;
  /** the option as offered, or one built here for a search pick or a pack size */
  option: Pick<QuestionOption, "action" | "label" | "packs_per_unit">;
  /** the ingredient or product the answer names, for the "Saved." sentence */
  matchedName?: string | null;
  packs?: number | null;
}

const VARIANT: Record<OptionVariant, string> = {
  primary: "bg-accent-fill text-accent-on",
  tinted: "bg-accent-soft text-accent",
  plain: "bg-fill text-label",
  danger: "bg-danger-soft text-danger",
};

/** One answer button: full width, 56px high at every width, the label over a quiet second line. */
function AnswerButton({ label, sub, variant, disabled, busy, onClick }: { label: string; sub: string | null; variant: OptionVariant; disabled?: boolean; busy?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx("flex min-h-[56px] w-full flex-col justify-center rounded-xl px-4 py-2.5 text-left transition active:scale-[0.99] active:opacity-80 disabled:pointer-events-none disabled:opacity-50", VARIANT[variant])}
    >
      <span className="text-[17px] font-semibold leading-snug">{busy ? "Saving..." : label}</span>
      {sub && !busy ? <span className="mt-0.5 text-[13px] leading-snug opacity-80">{sub}</span> : null}
    </button>
  );
}

/**
 * One question: the prompt in plain words, the invoice line it is about, a link to the invoice page, a search for a
 * different ingredient (when the line is not matched), the pack-size helper (when the unit is the problem) and the answers.
 * It never answers on its own: every send is one tap by a person, and the screen decides what happens next.
 */
export function QuestionCard({
  bundle,
  look,
  searchDocs,
  sb,
  onAnswer,
}: {
  bundle: QuestionBundle;
  look: OptionLookups;
  searchDocs: readonly IngredientDoc[];
  sb: SupabaseClient;
  onAnswer: (b: QuestionBundle, choice: AnswerChoice) => Promise<string | null>;
}) {
  const { q, doc, line } = bundle;
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const text = lineText(line);

  async function send(id: string, choice: AnswerChoice) {
    if (busy) return;
    setProblem(null);
    setBusy(id);
    const err = await onAnswer(bundle, choice);
    // on success the screen removes this card; on a problem it stays and says why
    setBusy(null);
    if (err) setProblem(err);
  }

  const views = q.options.map((o) => ({ o, v: describeOption(o, look, line?.unit) }));

  return (
    <article className="rounded-2xl bg-surface p-4" aria-label={q.prompt}>
      <p className="text-[17px] font-semibold leading-snug">{q.prompt}</p>

      {text ? (
        <div className="mt-3 rounded-xl bg-surface-2 px-3 py-2.5">
          <p className="break-words text-[15px] font-medium leading-snug">{text.title}</p>
          {text.meta ? <p className="mt-0.5 break-words text-[13px] leading-snug text-label-2 tnum">{text.meta}</p> : null}
        </div>
      ) : null}

      <PdfLink sb={sb} path={doc?.page_pdf_path} className="mt-3" />

      {canSearchIngredients(q.kind) ? (
        <div className="mt-4">
          <IngredientPicker
            docs={searchDocs}
            disabled={!!busy}
            onPick={(ing: IngredientLite) =>
              void send(`custom:${ing.id}`, { ...ingredientAnswer(ing.id), option: { action: undefined, label: ing.name, packs_per_unit: null }, matchedName: ing.name })
            }
          />
        </div>
      ) : null}

      {needsPackHelper(q.kind) ? (
        <div className="mt-4">
          <PackHelper unit={line?.unit} disabled={!!busy} onSave={(n) => void send("custom:packs", { ...packsAnswer(n), option: { action: undefined, label: `${n} in each`, packs_per_unit: n }, packs: n })} />
        </div>
      ) : null}

      {views.length ? (
        <div className="mt-4 flex flex-col gap-2" role="group" aria-label="Answers">
          {views.map(({ o, v }) => (
            <AnswerButton
              key={o.id}
              label={v.label}
              sub={v.sub}
              variant={v.variant}
              disabled={!!busy}
              busy={busy === o.id}
              onClick={() =>
                void send(o.id, {
                  optionId: o.id,
                  option: o,
                  matchedName: isMatchOption(o) ? (o.ingredient_id ? look.ingredients.get(o.ingredient_id)?.name : look.products.get(o.product_id ?? "")?.name) ?? o.label : null,
                })
              }
            />
          ))}
        </div>
      ) : null}

      {problem ? (
        <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-[15px] text-danger">
          {problem}
        </p>
      ) : null}
    </article>
  );
}
