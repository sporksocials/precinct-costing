"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { answerQuestion } from "@/lib/invoice-answer";
import { answeredLabel, brisbaneStamp, countLabel, groupQuestions, groupTitle, ingredientSearchDocs, lineText, savedText, type IngredientLite, type OptionLookups, type QuestionBundle } from "@/lib/invoice-questions-view";
import { Banner, cx, Empty, ListSkeleton, PageHeader, Row, useToast } from "@/components/ui";
import { VenueFilter, useVenue } from "@/components/venue";
import { VenueTag } from "@/components/brand";
import { usePersonName } from "@/components/use-person-name";
import { useUrlState } from "@/components/use-url-state";
import { TouchBack, TouchSegmented } from "@/components/ordering/touch";
import { INVOICES_UNAVAILABLE } from "@/lib/invoice-data-extra";
import { QuestionCard, type AnswerChoice } from "./q-card";
import { ANSWERED_CAP, useQuestions } from "./q-use-questions";

type Tab = "open" | "answered";

/**
 * /invoices/questions: where the venue managers answer what the invoice reader could not settle. Open questions grouped by
 * invoice, newest first; an Answered tab shows who answered what and when. `?doc=<id>` shows one invoice, `?venue=<slug>` one venue.
 */
export function QuestionsScreen() {
  const store = useStore();
  const toast = useToast();
  const nameOf = usePersonName();
  const params = useSearchParams();
  const docId = params.get("doc");
  const { venue } = useVenue();
  const [tabRaw, setTab] = useUrlState("tab", "open");
  const tab: Tab = tabRaw === "answered" ? "answered" : "open";
  const { sb, open, answered, products, available, error, reload } = useQuestions(venue?.id ?? null, docId);
  // cards answered this visit leave the list at once, before the fresh copy arrives
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [last, setLast] = useState<string | null>(null);

  const ingredients = useMemo<IngredientLite[]>(() => store.ingredients, [store.ingredients]);
  const look = useMemo<OptionLookups>(() => ({ ingredients: new Map(ingredients.map((i) => [i.id, i])), products }), [ingredients, products]);
  const searchDocs = useMemo(() => ingredientSearchDocs(ingredients, (id) => store.supplierById.get(id)?.name), [ingredients, store.supplierById]);

  const shownOpen = useMemo(() => (open ?? []).filter((b) => !gone.has(b.q.id)), [open, gone]);
  const groups = useMemo(() => groupQuestions(shownOpen, store.today), [shownOpen, store.today]);

  const onAnswer = useCallback(
    async (b: QuestionBundle, c: AnswerChoice): Promise<string | null> => {
      try {
        const res = await answerQuestion(sb, { questionId: b.q.id, optionId: c.optionId, actor: store.userEmail ?? "unknown", note: c.note });
        if (!res.ok) return res.message || "That did not save. Try again.";
        setGone((g) => new Set(g).add(b.q.id));
        setLast(res.message || null);
        toast.show({ message: savedText(b, c.option, c.matchedName, c.packs) });
        // the answer may have settled other cards on the same invoice, or raised a new one: read the list again
        void reload();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "That did not save. Try again.";
      }
    },
    [sb, store.userEmail, toast, reload],
  );

  const loading = open === null || answered === null;
  const openCount = shownOpen.length;

  return (
    <div className="max-w-2xl pb-8">
      <div className="pt-1 lg:pt-6">
        <TouchBack path="/invoices" fallback="/invoices">
          Invoices
        </TouchBack>
      </div>
      <PageHeader title="Questions" subtitle={loading ? undefined : openCount ? `${openCount} to answer` : "All answered"} className="!pt-0 lg:!pt-2" />

      <VenueFilter stats={false} compact />

      <div className="mt-4">
        <TouchSegmented<Tab>
          ariaLabel="Questions"
          value={tab}
          onChange={(t) => setTab(t === "open" ? "" : t)}
          options={[
            { value: "open", label: loading ? "To Answer" : countLabel("To Answer", openCount) },
            { value: "answered", label: loading ? "Answered" : countLabel("Answered", answered?.length ?? 0, ANSWERED_CAP) },
          ]}
        />
      </div>

      {docId ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-fill px-4 py-2 text-[15px] text-label-2">
          <span>Showing one invoice.</span>
          <Link href="/invoices/questions" className="inline-flex min-h-[44px] items-center font-medium text-accent">
            Show All Questions
          </Link>
        </div>
      ) : null}

      {error ? <Banner>{error}</Banner> : null}
      {loading && !error ? <ListSkeleton rows={4} /> : null}
      {!loading && !available ? <Empty title="Invoices Are Not Set Up Yet" body={INVOICES_UNAVAILABLE} /> : null}

      {!loading && available && tab === "open" ? (
        <>
          {last ? (
            <p className="mt-4 flex items-start gap-2 rounded-xl bg-fill px-4 py-2.5 text-[15px] text-label-2" aria-live="polite">
              <CheckCircle2 className="mt-0.5 h-[18px] w-[18px] shrink-0 text-good" strokeWidth={2.25} aria-hidden />
              <span className="min-w-0">{last}</span>
            </p>
          ) : null}
          {groups.length === 0 ? (
            <Empty title="Nothing To Answer" body="Nice work." />
          ) : (
            groups.map((g) => {
              const v = store.venueById.get(g.venueId);
              return (
                <section key={g.docId} className="mt-6" aria-label={g.title}>
                  <div className="flex items-end justify-between gap-3 px-1 pb-2">
                    <div className="min-w-0">
                      <h2 className="text-[17px] font-semibold leading-snug">{g.title}</h2>
                      {!venue && v ? <p className="mt-0.5 text-[13px] text-label-2"><VenueTag slug={v.slug} name={v.name} size={16} /></p> : null}
                    </div>
                    <Link href={`/invoices/${g.docId}`} className="inline-flex min-h-[44px] shrink-0 items-center text-[15px] font-medium text-accent">
                      Open Invoice
                    </Link>
                  </div>
                  <div className="flex flex-col gap-3">
                    {g.bundles.map((b) => (
                      <QuestionCard key={b.q.id} bundle={b} look={look} searchDocs={searchDocs} sb={sb} onAnswer={onAnswer} />
                    ))}
                  </div>
                </section>
              );
            })
          )}
        </>
      ) : null}

      {!loading && available && tab === "answered" ? (
        (answered ?? []).length === 0 ? (
          <Empty title="No Answers Yet" body="Answers appear here with who gave them and when." />
        ) : (
          <div className={cx("group-list mt-5")}>
            {(answered ?? []).map((b) => {
              const text = lineText(b.line);
              const who = nameOf(b.q.answered_by) ?? "Someone";
              const when = brisbaneStamp(b.q.answered_at);
              const label = answeredLabel(b.q, (id) => store.ingredients.find((i) => i.id === id)?.name);
              return (
                <Row
                  key={b.q.id}
                  href={`/invoices/${b.q.document_id}`}
                  title={label}
                  sub={[`${who}${when ? `, ${when}` : ""}`, groupTitle(b, store.today), text?.title].filter(Boolean).join(" · ")}
                  wrapSub
                  chevron
                />
              );
            })}
          </div>
        )
      ) : null}
    </div>
  );
}
