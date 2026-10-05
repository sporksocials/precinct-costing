"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, TriangleAlert } from "lucide-react";
import { useStore } from "@/lib/store";
import { groupProductsByCategory } from "@/lib/ordering";
import {
  activeCategory,
  categoryAnchor,
  categoryJumps,
  filterGroups,
  finaliseBlock,
  progressText,
  reviewLists,
  rowAnchor,
  whenText,
} from "@/lib/ordering-count-ui";
import type { OrderingProduct, OrderingCategory } from "@/lib/ordering-types";
import { BackLink } from "@/components/back-link";
import { VENUE_SHORT, VenueAccent } from "@/components/venue";
import { Banner, Empty, ListSkeleton, PageHeader, Skeleton } from "@/components/ui";
import { usePersonName } from "@/components/use-person-name";
import type { Venue } from "@/lib/types";
import { CancelSheet } from "./cancel-sheet";
import { LeaveSheet } from "./leave-sheet";
import { CountHeader } from "./count-header";
import { CountRow } from "./count-row";
import { OfflineWorker } from "./offline-worker";
import { ReviewSheet } from "./review-sheet";
import { StartPanel } from "./start-panel";
import { useCountSession } from "./use-count-session";

/** Ordering > Count for one venue (phone and tablet first, works with patchy wifi). The venue comes from the URL slug. */
export function CountScreen({ slug }: { slug: string }) {
  const { venues } = useStore();
  const venue = venues.find((v) => v.slug === slug);
  if (!venue) {
    return (
      <div className="mx-auto max-w-[720px]">
        <Empty title="Venue not found" body="That address does not match one of the four venues." action={<Link href="/ordering" className="btn-primary !min-h-[44px]">Back To Ordering</Link>} />
      </div>
    );
  }
  return <VenueCount venue={venue} />;
}

/** Cancel Count sits beside Finish Count (top and bottom): the same size, tinted red, never a small text link. */
const CANCEL_BTN = "inline-flex min-h-[48px] touch-manipulation select-none items-center justify-center rounded-xl bg-danger-soft px-4 text-[16px] font-semibold text-danger transition active:scale-[0.98] active:opacity-80 motion-reduce:transition-none";

function VenueCount({ venue }: { venue: Venue }) {
  const { userEmail } = useStore();
  const nameOf = usePersonName();
  const c = useCountSession(venue.id, userEmail);
  const router = useRouter();
  const { setQty, setPar, enter, finalise, cancel } = c;
  const venueName = VENUE_SHORT[venue.slug] ?? venue.name;
  const base = `/ordering/${venue.slug}`;

  const [query, setQuery] = useState("");
  const [uncountedOnly, setUncountedOnly] = useState(false);
  const [pinned, setPinned] = useState<ReadonlySet<string>>(() => new Set());
  const [editing, setEditing] = useState(false);
  const [justFinalised, setJustFinalised] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [finalising, setFinalising] = useState(false);
  const [finaliseError, setFinaliseError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveCancelling, setLeaveCancelling] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [jump, setJump] = useState<{ kind: "row" | "cat"; id: string; n: number } | null>(null);
  const [activeCat, setActiveCat] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);

  const counting = !!c.session;
  const finalisedView = c.session?.status === "finalised";
  const readOnly = finalisedView && !editing;

  const groups = useMemo(() => groupProductsByCategory(c.products, c.categories), [c.products, c.categories]);
  const secondLabel = useMemo(() => new Map<string, string | null>(c.categories.map((cat: OrderingCategory) => [cat.id, cat.second_location_label])), [c.categories]);
  const lists = useMemo(() => reviewLists(c.products, c.categories, c.qty), [c.products, c.categories, c.qty]);
  const jumps = useMemo(() => categoryJumps(groups, c.qty), [groups, c.qty]);
  const jumpById = useMemo(() => new Map(jumps.map((j) => [j.id, j])), [jumps]);
  const shown = useMemo(() => filterGroups(groups, c.qty, { query, uncountedOnly, pinned }), [groups, c.qty, query, uncountedOnly, pinned]);
  const blocked = finaliseBlock({ online: c.online, pending: c.pending, syncing: c.status.kind === "saving" });

  /* a different count in view starts with a clean screen */
  const sessionId = c.session?.id ?? null;
  useEffect(() => {
    setQuery("");
    setUncountedOnly(false);
    setPinned(new Set());
    setEditing(false);
    setReviewOpen(false);
    setFinaliseError(null);
    setActiveCat(null);
  }, [sessionId]);

  /* the sticky header's height, for the sticky category headers and the scroll offset of every jump */
  useLayoutEffect(() => {
    const head = headRef.current;
    const root = rootRef.current;
    if (!head || !root) return;
    const set = () => root.style.setProperty("--count-head", `calc(env(safe-area-inset-top, 0px) + ${head.getBoundingClientRect().height}px)`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(head);
    return () => ro.disconnect();
  }, [counting]);

  /* scroll spy: which category is under the header */
  useEffect(() => {
    if (!counting) return;
    let raf = 0;
    const calc = () => {
      raf = 0;
      const line = (headRef.current?.getBoundingClientRect().bottom ?? 0) + 8;
      const tops = shown.map((g) => ({ id: g.category.id, top: document.getElementById(categoryAnchor(g.category.id))?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY }));
      setActiveCat(activeCategory(tops, line));
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(calc);
    };
    calc();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [counting, shown]);

  /* jumps (category chips, the review sheet): scroll once the list has rendered with the filters cleared */
  useEffect(() => {
    if (!jump) return;
    const el = document.getElementById(jump.kind === "row" ? rowAnchor(jump.id) : categoryAnchor(jump.id));
    if (!el) return;
    el.scrollIntoView({ block: "start" });
    if (jump.kind !== "row") return;
    setFlash(jump.id);
    const t = window.setTimeout(() => setFlash(null), 2000);
    return () => window.clearTimeout(t);
  }, [jump]);

  const jumpToRow = useCallback((productId: string) => {
    setReviewOpen(false);
    setQuery("");
    setPinned((p) => (p.has(productId) ? p : new Set(p).add(productId)));
    setJump((j) => ({ kind: "row", id: productId, n: (j?.n ?? 0) + 1 }));
  }, []);
  const jumpToCategory = useCallback((categoryId: string) => {
    if (!document.getElementById(categoryAnchor(categoryId))) {
      setQuery("");
      setUncountedOnly(false);
    }
    setJump((j) => ({ kind: "cat", id: categoryId, n: (j?.n ?? 0) + 1 }));
  }, []);

  /* Show Uncounted keeps a row on screen once it has been touched, so it does not vanish under the finger that counted it */
  const onSet = useCallback(
    (product: OrderingProduct, place: "store" | "second", value: number | null) => {
      if (uncountedOnly) setPinned((p) => (p.has(product.id) ? p : new Set(p).add(product.id)));
      setQty(product, place, value);
    },
    [uncountedOnly, setQty],
  );
  const toggleUncounted = (on: boolean) => {
    setUncountedOnly(on);
    setPinned(new Set());
  };

  const begin = async (which: "open" | "last") => {
    setStarting(true);
    setStartError(null);
    const message = await enter(which);
    setStarting(false);
    setStartError(message);
    if (!message) {
      setJustFinalised(false);
      window.scrollTo({ top: 0 });
    }
  };

  const doFinalise = async () => {
    setFinalising(true);
    setFinaliseError(null);
    const r = await finalise();
    setFinalising(false);
    if (r.ok) {
      // the sheet's next step is the order: finishing the count takes you straight to the supplier orders built from it
      try {
        window.sessionStorage.setItem(`ordering-just-finished-${venue.id}`, "1");
      } catch {
        // storage blocked: Back from Orders may then open a fresh count, which is harmless
      }
      router.push(`${base}/orders`);
    } else setFinaliseError(r.message);
  };

  const openCancel = () => {
    setCancelError(null);
    setCancelOpen(true);
  };
  const doCancel = async () => {
    setCancelling(true);
    setCancelError(null);
    const message = await cancel();
    setCancelling(false);
    if (message) setCancelError(message);
    else {
      autoAttempts.current = 2; // cancelled on purpose: show the Start panel, do not open a new count straight away
      setCancelOpen(false);
      setReviewOpen(false);
      window.scrollTo({ top: 0 });
    }
  };

  /* Back to Ordering in the middle of a count asks: save it for later, cancel it, or keep counting. Nothing counted yet: just go. */
  const needsLeaveAsk = counting && c.session?.status === "in_progress" && lists.counted > 0;
  const onBackClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!needsLeaveAsk) return;
    e.preventDefault();
    setCancelError(null);
    setLeaveOpen(true);
  };
  const saveAndLeave = () => {
    c.syncNow(); // the numbers are already on this device; this just pushes them out now if there is signal
    setLeaveOpen(false);
    router.push(base);
  };
  const cancelAndLeave = async () => {
    setLeaveCancelling(true);
    setCancelError(null);
    const message = await cancel();
    setLeaveCancelling(false);
    if (message) setCancelError(message);
    else {
      autoAttempts.current = 2;
      setLeaveOpen(false);
      router.push(base);
    }
  };

  /* No Start step: opening Count goes straight into counting (the count in progress, or a new one). "?last=1" opens the last
     finished count instead (the Orders screen's Edit Count). The Start panel only shows when this cannot happen (offline
     with no count on the device, or a failed start) so the person is told why. */
  const autoBusy = useRef(false);
  const autoAttempts = useRef(0);
  const [autoTick, setAutoTick] = useState(0);
  useEffect(() => {
    if (autoBusy.current || autoAttempts.current >= 2 || c.phase !== "ready" || counting || lists.total === 0) return;
    // coming Back from the orders just made must not open a brand new count
    let justFinished = false;
    try {
      justFinished = window.sessionStorage.getItem(`ordering-just-finished-${venue.id}`) === "1";
      if (justFinished) window.sessionStorage.removeItem(`ordering-just-finished-${venue.id}`);
    } catch {
      // ignore
    }
    if (justFinished) {
      autoAttempts.current = 2;
      return;
    }
    const wantLast = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("last") === "1";
    const which: "open" | "last" | null = wantLast && c.lastSession ? "last" : c.openSession || c.online ? "open" : null;
    if (!which) return;
    autoBusy.current = true;
    autoAttempts.current += 1;
    // a second read of the venue can land just after the count opened and put the screen back on the Start panel: if that
    // happens the effect runs once more (autoTick) and opens it again, instead of leaving the person on the panel
    void begin(which).finally(() => {
      autoBusy.current = false;
      setAutoTick((t) => t + 1);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.phase, counting, lists.total, c.openSession, c.lastSession, c.online, autoTick]);

  /* ---------------------------------------------------------------- what to show */

  const header = (
    <>
      <VenueAccent slug={venue.slug} />
      <BackLink path={base} fallback={base} onClick={onBackClick} className="btn-text !min-h-[44px] -ml-1 !gap-0 !text-accent">
        <ChevronLeft className="h-6 w-6" strokeWidth={2.25} aria-hidden />
        Ordering
      </BackLink>
    </>
  );

  if (c.phase === "loading") {
    return (
      <div ref={rootRef} className="mx-auto w-full max-w-[720px]">
        {header}
        <PageHeader title="Count" subtitle={venueName} />
        <Skeleton className="mt-2 h-24 w-full" />
        <ListSkeleton rows={6} />
      </div>
    );
  }
  if (c.phase === "offline-empty" || c.phase === "unavailable") {
    return (
      <div ref={rootRef} className="mx-auto w-full max-w-[720px]">
        {header}
        <PageHeader title="Count" subtitle={venueName} />
        <Empty
          title={c.phase === "offline-empty" ? "You Are Offline" : "Count Could Not Open"}
          body={c.phase === "offline-empty" ? "This count has not been opened on this device yet. Connect once, open it, and from then on it works with no signal." : c.problem}
          action={
            <button type="button" className="btn-primary !min-h-[44px]" onClick={c.reload}>
              Try Again
            </button>
          }
        />
      </div>
    );
  }

  const finishedBanner =
    counting && finalisedView ? (
      <section className="mt-2 rounded-2xl bg-good-soft p-4" data-testid="count-saved">
        <h2 className="flex items-center gap-2 text-[20px] font-semibold text-good">
          <Check className="h-5 w-5" strokeWidth={3} aria-hidden />
          {justFinalised ? "Count Saved" : "Count Finalised"}
        </h2>
        <p className="mt-1.5 text-[15px] text-label">
          Finalised {whenText(c.session?.finalised_at)}
          {c.session?.finalised_by ? ` by ${nameOf(c.session.finalised_by) ?? "someone"}` : ""}.{" "}
          {editing ? "Editing is on. Every change is logged with who made it and the old number." : "It is read-only. Tap Edit Count to change a number: every edit is logged with the old value."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={`${base}/orders`} className="btn-primary !min-h-[44px]">
            Go To Orders
          </Link>
          <Link href={base} className="btn-plain !min-h-[44px]">
            Back To Ordering
          </Link>
        </div>
      </section>
    ) : null;

  const trailing = !counting ? null : finalisedView ? (
    <button type="button" className={editing ? "btn-plain !min-h-[44px]" : "btn-primary !min-h-[44px]"} onClick={() => setEditing((e) => !e)}>
      {editing ? "Done Editing" : "Edit Count"}
    </button>
  ) : (
    <>
      <button type="button" className={CANCEL_BTN} onClick={openCancel}>
        Cancel Count
      </button>
      <button type="button" className="btn-primary !min-h-[48px] !px-5" onClick={() => setReviewOpen(true)}>
        Finish Count
      </button>
    </>
  );

  return (
    <div ref={rootRef} className="mx-auto w-full max-w-[720px]">
      <OfflineWorker slug={venue.slug} counting={counting && !readOnly} />
      {header}
      <PageHeader title="Count" subtitle={venueName} trailing={trailing} />

      {c.memoryOnly ? (
        <Banner>
          <span className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            This device is not keeping a saved copy of your counts. Keep this page open until it says Saved.
          </span>
        </Banner>
      ) : null}
      {!c.online && counting ? (
        <Banner tone="neutral">No signal. Keep counting: every number is saved on this device and goes to the database when you are back online.</Banner>
      ) : null}
      {c.fromCache && c.online && counting ? <Banner tone="neutral">Showing the copy saved on this device while it checks for updates.</Banner> : null}

      {!counting ? (
        <StartPanel
          slug={venue.slug}
          venueName={venueName}
          productCount={lists.total}
          categoryCount={groups.length}
          open={c.openSession}
          last={c.lastSession}
          counted={lists.counted}
          total={lists.total}
          online={c.online}
          starting={starting}
          error={startError}
          nameOf={nameOf}
          onStart={() => void begin("open")}
          onViewLast={() => void begin("last")}
          onCancel={() => {
            setCancelError(null);
            setCancelOpen(true);
          }}
        />
      ) : (
        <>
          {finishedBanner}
          <CountHeader
            ref={headRef}
            counted={lists.counted}
            total={lists.total}
            status={c.status}
            query={query}
            onQuery={setQuery}
            uncountedOnly={uncountedOnly}
            uncountedLeft={lists.uncounted.length}
            onUncountedOnly={toggleUncounted}
            jumps={jumps}
            activeCategoryId={activeCat}
            onJump={jumpToCategory}
          />

          {shown.length === 0 ? (
            <Empty
              title={uncountedOnly && !query ? "Everything Is Counted" : "No Products Match"}
              body={uncountedOnly && !query ? "Nothing is left to count. Turn off Show Uncounted to see the whole list." : "Try a different spelling, or clear the search."}
              action={
                <button type="button" className="btn-plain !min-h-[44px]" onClick={() => (query ? setQuery("") : toggleUncounted(false))}>
                  {query ? "Clear Search" : "Show Everything"}
                </button>
              }
            />
          ) : (
            shown.map((g) => {
              const j = jumpById.get(g.category.id);
              const second = g.category.second_location_label;
              return (
                <section key={g.category.id} id={categoryAnchor(g.category.id)} aria-label={g.category.name} className="mt-3 scroll-mt-[var(--count-head,0px)]">
                  <h2 className="sticky z-20 flex items-baseline justify-between gap-3 bg-bg px-1 py-2" style={{ top: "var(--count-head, 0px)" }}>
                    <span className="text-[15px] font-semibold uppercase tracking-wide">{g.category.name}</span>
                    <span className="text-right text-[13px] text-label-2 tnum">
                      {j ? `${j.counted} of ${j.total} counted` : ""}
                      {second ? `, Store and ${second}` : ", Store only"}
                    </span>
                  </h2>
                  <ul className="divide-y divide-[color:var(--separator)] overflow-hidden rounded-2xl bg-surface">
                    {g.products.map((p) => {
                      const q = c.qty.get(p.id);
                      return <CountRow key={p.id} product={p} secondLabel={secondLabel.get(p.category_id) ?? null} store={q?.store ?? null} second={q?.second ?? null} readOnly={readOnly} flash={flash === p.id} onSet={onSet} onSetPar={setPar} />;
                    })}
                  </ul>
                </section>
              );
            })
          )}

          {!finalisedView ? (
            <div className="mt-6">
              <p className="mb-2 text-center text-[13px] text-label-2 tnum">{progressText(lists.counted, lists.total)}</p>
              <div className="flex gap-2">
                <button type="button" className={`${CANCEL_BTN} flex-1`} onClick={openCancel}>
                  Cancel Count
                </button>
                <button type="button" className="btn-primary !min-h-[48px] flex-1" onClick={() => setReviewOpen(true)}>
                  Finish Count
                </button>
              </div>
            </div>
          ) : null}

          <ReviewSheet
            open={reviewOpen}
            onClose={() => setReviewOpen(false)}
            lists={lists}
            blocked={blocked}
            busy={finalising}
            error={finaliseError}
            onJump={jumpToRow}
            onFinalise={() => void doFinalise()}
            onRetry={c.syncNow}
          />
        </>
      )}

      <LeaveSheet open={leaveOpen} counted={lists.counted} total={lists.total} busy={leaveCancelling} error={cancelError} onSave={saveAndLeave} onKeep={() => setLeaveOpen(false)} onCancel={() => void cancelAndLeave()} />
      <CancelSheet open={cancelOpen} counted={lists.counted} total={lists.total} busy={cancelling} error={cancelError} onKeep={() => setCancelOpen(false)} onCancel={() => void doCancel()} />
    </div>
  );
}
