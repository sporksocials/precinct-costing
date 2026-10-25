"use client";

import Link from "next/link";
import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { answerQuestion } from "@/lib/invoice-answer";
import { answerLabel, NEEDS_SURE, SURE_TEXT, type CheckTask } from "@/lib/invoice-todo-checks";
import { PACK_PRESETS, packsAnswer, parsePacks, unitWord } from "@/lib/invoice-questions-view";
import { dayLabel } from "@/lib/invoice-view";
import { cx } from "@/components/ui";
import { TouchButton, TouchSheet } from "@/components/ordering/touch";
import { ViewInvoiceButton } from "./approve-pdf";

/** "Supplier · Invoice 51329 · 14 Oct 2026" */
export function taskHeading(t: Pick<CheckTask, "supplierName" | "doc">): string {
  const no = t.doc.invoice_number?.trim();
  return [t.supplierName, no ? `Invoice ${no}` : "Invoice", dayLabel(t.doc.invoice_date)].filter(Boolean).join(" · ");
}

/** The pack size answer: a few common numbers, or a typed one. Nothing is sent until Save Pack Size. */
function PackAnswer({ unit, disabled, onSave }: { unit: string | null | undefined; disabled: boolean; onSave: (n: number) => void }) {
  const [text, setText] = useState("");
  const packs = parsePacks(text);
  const word = unitWord(unit);
  return (
    <div className="rounded-xl bg-surface-2 p-3">
      <p className="text-[15px] font-medium">How many are in one {word}?</p>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Common pack sizes">
        {PACK_PRESETS.map((n) => {
          const on = packs === n;
          return (
            <button
              key={n}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              onClick={() => setText(String(n))}
              className={cx("min-h-[44px] min-w-[44px] rounded-full px-4 text-[17px] font-semibold transition active:scale-[0.97] disabled:opacity-40", on ? "bg-accent-fill text-accent-on" : "bg-fill text-label")}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <label className="flex min-h-[48px] flex-1 items-center rounded-xl bg-fill px-3 focus-within:shadow-[inset_0_0_0_1.5px_var(--accent-fill)]">
          <span className="sr-only">Number in one {word}</span>
          <input
            inputMode="decimal"
            autoComplete="off"
            value={text}
            disabled={disabled}
            placeholder="Or type a number"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && packs != null) onSave(packs);
            }}
            className="min-w-0 flex-1 bg-transparent py-3 text-[17px] text-label outline-none placeholder:text-label-3"
          />
        </label>
        <TouchButton variant="primary" disabled={disabled || packs == null} onClick={() => packs != null && onSave(packs)}>
          Save Pack Size
        </TouchButton>
      </div>
      {text.trim() && packs == null ? (
        <p role="alert" className="mt-1.5 text-[13px] text-danger">
          Type a whole or decimal number above zero, such as 12.
        </p>
      ) : null}
    </div>
  );
}

/**
 * One thing to check, as a task: who and which invoice, what is odd in one sentence, the same answer buttons the question offers,
 * and a way to look at the invoice itself. An answer is sent the moment it is tapped (a few ask first), and the card leaves the
 * list. If it cannot be saved the card stays and says why.
 */
export function CheckCard({ task, sb, actor, onDone }: { task: CheckTask; sb: SupabaseClient; actor: string; onDone: (taskId: string, message: string, applied: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sure, setSure] = useState<{ id: string; label: string } | null>(null);
  const q = task.q;

  async function send(optionId: string, note?: string) {
    setBusy(true);
    setProblem(null);
    try {
      const r = await answerQuestion(sb, { questionId: q.id, optionId, actor, note });
      if (!r.ok) {
        setProblem(r.message);
        return;
      }
      onDone(q.id, r.message, r.applied.some((a) => a.ok && a.changeIds.length > 0));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "That could not be saved.");
    } finally {
      setBusy(false);
      setSure(null);
    }
  }

  const options = q.kind === "unit_unclear" ? q.options.filter((o) => o.id === "ignore_line") : q.options;
  const choose = (o: { id: string; label: string }) => (NEEDS_SURE.has(o.id) ? setSure({ id: o.id, label: answerLabel(o) }) : void send(o.id));

  return (
    <li className="rounded-2xl bg-surface p-4" aria-label={`${task.supplierName}: ${task.sentence}`}>
      <p className="text-[13px] leading-snug text-label-2">
        <Link href={`/invoices/${task.doc.id}`} className="inline-flex min-h-[44px] items-center font-medium text-accent">
          {taskHeading(task)}
        </Link>
      </p>
      <p className="break-words text-[17px] font-semibold leading-snug">{task.sentence}</p>
      {task.detail ? <p className="mt-1 break-words text-[15px] leading-snug text-label-2 sm:text-[13px]">{task.detail}</p> : null}

      {q.kind === "unit_unclear" ? (
        <div className="mt-3">
          <PackAnswer
            unit={task.line?.unit}
            disabled={busy}
            onSave={(n) => {
              const a = packsAnswer(n);
              void send(a.optionId, a.note);
            }}
          />
        </div>
      ) : null}

      {options.length ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap" role="group" aria-label="Answers">
          {options.map((o, i) => (
            <TouchButton key={o.id} variant={i === 0 && q.kind !== "unit_unclear" ? "primary" : "plain"} disabled={busy} onClick={() => choose(o)} className="sm:w-auto">
              {answerLabel(o)}
            </TouchButton>
          ))}
        </div>
      ) : null}

      <ViewInvoiceButton path={task.doc.page_pdf_path} className="mt-2" />

      {problem ? (
        <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-[15px] text-danger">
          {problem}
        </p>
      ) : null}

      <TouchSheet open={sure !== null} onClose={() => setSure(null)} title="Are You Sure?" size="sm">
        <div className="space-y-4 pb-2">
          <h3 className="text-[20px] font-semibold leading-tight">{sure?.label}?</h3>
          <p className="text-[15px] text-label-2">{sure ? (SURE_TEXT[sure.id] ?? "") : ""}</p>
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <TouchButton variant="primary" disabled={busy} onClick={() => sure && void send(sure.id)} className="sm:flex-1">
              {sure?.label}
            </TouchButton>
            <TouchButton onClick={() => setSure(null)} className="sm:flex-1">
              Not Yet
            </TouchButton>
          </div>
        </div>
      </TouchSheet>
    </li>
  );
}
