"use client";

import { useMemo } from "react";
import { Check } from "lucide-react";
import { useStore } from "@/lib/store";
import { useInvoiceList } from "@/lib/invoice-data";
import { useMatchCounts } from "@/lib/invoice-todo-match";
import { useApproveCounts } from "@/lib/invoice-todo-approve";
import { homeCounts, outcomeStats, statusSentence, todoLabel, todoTotal, weekRange, type ChangeLite, type TodoNumbers } from "@/lib/invoice-view";
import { useVenue } from "@/components/venue";
import { Banner, Empty, ListSkeleton, PageHeader } from "@/components/ui";
import { TouchButton, TouchSegmented } from "@/components/ordering/touch";
import { useUrlState } from "@/components/use-url-state";
import { VenueChips } from "./inv-parts";
import { DiscountsView } from "./inv-discounts";
import { ChangesView } from "./inv-changes";
import { AllInvoices } from "./inv-all";
import { MatchItemsSection } from "./todo-match";
import { ApprovePricesSection } from "./todo-approve";
import { ChecksSection } from "./todo-checks";

type Tab = "todo" | "changes" | "discounts" | "all";
const TABS: Tab[] = ["todo", "changes", "discounts", "all"];
const readTab = (v: string): Tab => (TABS.includes(v as Tab) ? (v as Tab) : "todo");

/**
 * Invoices (Troy, 25 Oct 2026: "think of the people using it and what they want to see"). Top to bottom and nothing else: the title,
 * ONE sentence of status, ONE four-way control (To Do, Changes, Discounts, All Invoices), venue chips only when more than one venue has
 * invoices, then the body. To Do is the default: three jobs (Match Items, Approve Prices, Check These) built by their own sections.
 * The numbers on the control, the Home card and the empty state all come from the same two count hooks.
 */
export function InvoicesScreen() {
  const { today, venueById } = useStore();
  const { venue } = useVenue();
  const slug = venue?.slug ?? null;
  const [tabRaw, setTab] = useUrlState("tab", "todo");
  const tab = readTab(tabRaw);
  const list = useInvoiceList();
  const match = useMatchCounts(slug);
  const approve = useApproveCounts(slug);
  const todo: TodoNumbers = { items: match.data?.items ?? 0, prices: approve.data?.prices ?? 0, checks: approve.data?.checks ?? 0 };
  const todoN = todoTotal(todo);
  const countsKnown = !!match.data && !!approve.data;

  const data = list.data;
  const docs = useMemo(() => (data ? data.documents.filter((d) => !venue || d.venue_id === venue.id) : []), [data, venue]);
  const outcomes = useMemo(() => (data ? outcomeStats(data.lines, data.questions) : new Map()), [data]);
  const counts = useMemo(() => {
    if (!data) return null;
    const changes: ChangeLite[] = data.changes.filter((c) => !venue || c.venue_id === venue.id);
    return homeCounts({ docs, changes, range: weekRange(today), totalDocs: docs.length });
  }, [data, docs, venue, today]);
  const venueSlugs = useMemo(() => {
    const s = new Set<string>();
    for (const d of data?.documents ?? []) {
      const v = venueById.get(d.venue_id);
      if (v) s.add(v.slug);
    }
    return [...s];
  }, [data, venueById]);

  const firstRun = !!data && !data.missing && data.documents.length === 0;

  const body = (() => {
    // Discounts We Found reads its own lines, so it does not wait on (or hide behind) the invoice list
    if (tab === "discounts") return <DiscountsView venueId={venue?.id ?? null} />;
    if (tab === "todo") return <TodoBody venue={slug} known={countsKnown} total={todoN} reading={counts?.reading ?? 0} listReady={!!data} />;
    if (list.loading && !data) return <ListSkeleton rows={8} />;
    if (list.error && !data) return <Banner action={<TouchButton onClick={() => void list.reload()}>Try Again</TouchButton>}>{list.error}</Banner>;
    if (!data) return null;
    if (data.missing) return <Empty title="Invoices Are Not Set Up Yet" body="Once they are, every scanned invoice appears here with what it changed." />;
    if (tab === "changes") return <ChangesView changes={data.changes} documents={data.documents} supplierNames={data.supplierNames} venueId={venue?.id ?? null} showVenue={!venue && venueSlugs.length > 1} onChanged={() => void list.reload()} />;
    return <AllInvoices data={data} outcomes={outcomes} venueId={venue?.id ?? null} showVenue={!venue && venueSlugs.length > 1} today={today} />;
  })();

  return (
    <div>
      <PageHeader title="Invoices" />
      {counts ? <p className="-mt-1 text-[15px] text-label-2" aria-live="polite">{statusSentence(counts)}</p> : null}
      {firstRun ? null : (
        <div className="mt-4 space-y-3">
          <TouchSegmented<Tab>
            ariaLabel="Invoices"
            className="sm:max-w-xl [&>button]:px-1 sm:[&>button]:px-3"
            value={tab}
            onChange={(v) => setTab(v === "todo" ? "" : v)}
            options={[
              { value: "todo", label: todoLabel(todoN) },
              { value: "changes", label: "Changes" },
              { value: "discounts", label: "Discounts" },
              { value: "all", label: "All Invoices" },
            ]}
          />
          <VenueChips slugs={venueSlugs} />
        </div>
      )}
      <div className="mt-4">{firstRun ? null : body}</div>
    </div>
  );
}

/**
 * The To Do body: the three jobs in order, each one a section that draws its own title and renders nothing when it has nothing.
 * Only when both count hooks have answered and the total is zero is the whole page replaced by the calm "All Caught Up".
 */
function TodoBody({ venue, known, total, reading, listReady }: { venue: string | null; known: boolean; total: number; reading: number; listReady: boolean }) {
  if (known && total === 0 && listReady) {
    return (
      <div className="flex flex-col items-center px-6 py-16 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-fill text-label-2">
          <Check aria-hidden className="h-6 w-6" strokeWidth={2.5} />
        </span>
        <p className="mt-4 text-[20px] font-semibold">All Caught Up</p>
        <p className="mt-1.5 max-w-xs text-[15px] text-label-2">Nothing needs you. New invoices appear here when they arrive.</p>
        {reading > 0 ? <p className="mt-1 text-[15px] text-label-2">{`${reading} ${reading === 1 ? "is" : "are"} still being read.`}</p> : null}
      </div>
    );
  }
  return (
    <div className="space-y-8">
      <MatchItemsSection venue={venue} />
      <ApprovePricesSection venue={venue} />
      <ChecksSection venue={venue} />
    </div>
  );
}
