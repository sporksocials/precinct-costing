"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { answeredLabel, brisbaneStamp, countLabel, groupQuestions, groupTitle, ingredientSearchDocs, lineText, splitReview, type IngredientLite, type OptionLookups } from "@/lib/invoice-questions-view";
import { Banner, cx, Empty, ListSkeleton, PageHeader, Row, useToast } from "@/components/ui";
import { VenueFilter, useVenue } from "@/components/venue";
import { VenueTag } from "@/components/brand";
import { usePersonName } from "@/components/use-person-name";
import { useUrlState } from "@/components/use-url-state";
import { TouchBack, TouchLink, TouchSegmented } from "@/components/ordering/touch";
import { INVOICES_UNAVAILABLE } from "@/lib/invoice-data-extra";
import { InvoiceReview } from "./q-review";
import { ANSWERED_CAP, useQuestions } from "./q-use-questions";

type Tab = "open" | "answered";

/**
 * /invoices/questions: Match Lines. Each invoice with something to answer is ONE review (every line on one screen, one Save
 * Matches). With a single invoice waiting, or `?doc=<id>`, the review opens straight away; with several, each is a card that
 * opens its own review. An Answered tab shows who answered what and when. `?venue=<slug>` narrows to one venue.
 */
export function QuestionsScreen() {
  const store = useStore();
  const nameOf = usePersonName();
  const params = useSearchParams();
  const docId = params.get("doc");
  const { venue } = useVenue();
  const [tabRaw, setTab] = useUrlState("tab", "open");
  const tab: Tab = tabRaw === "answered" ? "answered" : "open";
  const { sb, open, answered, products, available, error, reload } = useQuestions(venue?.id ?? null, docId);
  // questions answered this visit leave the list at once, before the fresh copy arrives
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [last, setLast] = useState<{ message: string; ok: boolean } | null>(null);

  const ingredients = useMemo<IngredientLite[]>(() => store.ingredients, [store.ingredients]);
  const look = useMemo<OptionLookups>(() => ({ ingredients: new Map(ingredients.map((i) => [i.id, i])), products }), [ingredients, products]);
  const searchDocs = useMemo(() => ingredientSearchDocs(ingredients, (id) => store.supplierById.get(id)?.name), [ingredients, store.supplierById]);

  const shownOpen = useMemo(() => (open ?? []).filter((b) => !gone.has(b.q.id)), [open, gone]);
  const groups = useMemo(() => groupQuestions(shownOpen, store.today), [shownOpen, store.today]);

  const resolved = useCallback((ids: string[]) => setGone((g) => new Set([...g, ...ids])), []);
  const saved = useCallback(
    (message: string, ok: boolean) => {
      setLast({ message, ok });
      // the answers may have settled other lines on the invoice, or raised a new question (a pack size): read the list again
      void reload();
    },
    [reload],
  );

  const loading = open === null || answered === null;
  const openCount = shownOpen.length;
  const single = docId != null || groups.length === 1;

  return (
    <div className="max-w-5xl pb-8">
      <div className="pt-1 lg:pt-6">
        <TouchBack path="/invoices" fallback="/invoices">
          Invoices
        </TouchBack>
      </div>
      <PageHeader title="Match Lines" subtitle={loading ? undefined : openCount ? `${openCount} to answer` : "All answered"} className="!pt-0 lg:!pt-2" />

      <VenueFilter stats={false} compact />

      <div className="mt-4 max-w-md">
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
            Show All Invoices
          </Link>
        </div>
      ) : null}

      {error ? <Banner>{error}</Banner> : null}
      {loading && !error ? <ListSkeleton rows={4} /> : null}
      {!loading && !available ? <Empty title="Invoices Are Not Set Up Yet" body={INVOICES_UNAVAILABLE} /> : null}

      {!loading && available && tab === "open" ? (
        <>
          {last ? (
            <p
              className={cx("mt-4 flex items-start gap-2 rounded-xl px-4 py-2.5 text-[15px]", last.ok ? "bg-fill text-label-2" : "bg-warn-soft text-warn")}
              aria-live="polite"
            >
              <CheckCircle2 className={cx("mt-0.5 h-[18px] w-[18px] shrink-0", last.ok ? "text-good" : "text-warn")} strokeWidth={2.25} aria-hidden />
              <span className="min-w-0">{last.message}</span>
            </p>
          ) : null}
          {groups.length === 0 ? (
            <Empty title="Nothing To Answer. Nice work." body="New questions appear here when an invoice needs a hand." />
          ) : single ? (
            groups.map((g) => {
              const v = store.venueById.get(g.venueId);
              return (
                <InvoiceReview
                  key={g.docId}
                  group={g}
                  look={look}
                  searchDocs={searchDocs}
                  ingredients={ingredients}
                  sb={sb}
                  actor={store.userEmail ?? "unknown"}
                  venueSlug={v?.slug ?? null}
                  venueName={v?.name ?? null}
                  showVenue={!venue}
                  onSaved={saved}
                  onResolved={resolved}
                />
              );
            })
          ) : (
            <ul className="mt-5 flex flex-col gap-3" aria-label="Invoices to match">
              {groups.map((g) => {
                const v = store.venueById.get(g.venueId);
                const { match, other } = splitReview(g.bundles);
                const parts = [match.length ? `${match.length} ${match.length === 1 ? "line" : "lines"} to match` : null, other.length ? `${other.length} other ${other.length === 1 ? "question" : "questions"}` : null].filter(Boolean);
                return (
                  <li key={g.docId} className="flex flex-col gap-3 rounded-2xl bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="break-words text-[17px] font-semibold leading-snug">{g.title}</p>
                      <p className="mt-0.5 text-[15px] text-label-2">{parts.join(" and ")}</p>
                      {!venue && v ? (
                        <p className="mt-0.5 text-[13px] text-label-2">
                          <VenueTag slug={v.slug} name={v.name} size={16} />
                        </p>
                      ) : null}
                    </div>
                    <TouchLink href={`/invoices/questions?doc=${g.docId}`} variant="primary" className="w-full sm:w-auto">
                      Match Lines
                    </TouchLink>
                  </li>
                );
              })}
            </ul>
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
