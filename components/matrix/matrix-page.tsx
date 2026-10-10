"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ListChecks, Printer } from "lucide-react";
import { buildRows, matrixProgress, matrixSections, progressLine } from "@/lib/allergy-matrix";
import { matrixPrintHref } from "@/lib/allergy-matrix-print";
import { matrixDishesForVenue } from "@/lib/allergy-matrix-store";
import { ALL_SECTIONS, printStatus } from "@/lib/matrix-prints";
import { approvalCount, venueTodo } from "@/lib/matrix-todo";
import { useStore } from "@/lib/store";
import { Chips, Empty, Group, PageHeader, Row } from "../ui";
import { AllergenTabs } from "./allergen-tabs";
import { useAllergenIndex } from "../allergen-picker";
import { useUrlState } from "../use-url-state";
import { PrintStatusBlock, sheetName } from "./printed";
import { useVenue, VenueFilter, VENUE_SHORT } from "../venue";
import { DishCard, MatrixLegend, MatrixTable } from "./parts";

const ALL = "all";

/**
 * Allergy Matrix (Troy, 10 Oct 2026): the laminated sheet each kitchen keeps, generated from the dishes' own allergens sections.
 * Read only: no cell can be edited here; a chef changes the dish in the recipe editor. One venue at a time (the venue tiles),
 * one matrix per menu section, plus an All Sections view. Printing goes to /matrix/print (A4 landscape), and the same matrix
 * lives on the kitchen iPad at /kitchen/<venue>/matrix.
 */
export function MatrixPage() {
  const store = useStore();
  const idx = useAllergenIndex();
  const { venue, setVenue } = useVenue();
  const [sectionParam, setSection] = useUrlState("section", ALL);
  const { loadMatrixPrints, matrixPrints } = store;
  useEffect(() => {
    loadMatrixPrints();
  }, [loadMatrixPrints]);

  const perVenue = useMemo(
    () =>
      store.venues.map((v) => {
        const rows = buildRows(matrixDishesForVenue(store.items, idx, v.id));
        return { venue: v, rows, progress: matrixProgress(rows) };
      }),
    [store.venues, store.items, idx],
  );
  const current = venue ? perVenue.find((p) => p.venue.id === venue.id) ?? null : null;

  const sections = useMemo(() => (current ? matrixSections(current.rows) : []), [current]);
  const section = sections.some((s) => s.label === sectionParam) ? sectionParam : ALL;
  const shown = section === ALL ? sections : sections.filter((s) => s.label === section);
  const shownRows = shown.flatMap((s) => s.rows);
  const [showAllNeeding, setShowAllNeeding] = useState(false);

  const venueName = venue ? VENUE_SHORT[venue.slug] ?? venue.name : "";
  const progress = current?.progress ?? null;
  const itemName = useMemo(() => new Map(store.items.map((i) => [i.id, i.name])), [store.items]);
  const todo = useMemo(() => (current ? venueTodo(current.venue, current.rows, matrixPrints, (id) => itemName.get(id) ?? null) : null), [current, matrixPrints, itemName]);
  const waiting = todo ? approvalCount(todo) : 0;
  // every sheet of this venue: All Sections, then each section (the print log is per venue and section)
  const sheetKeys = useMemo(() => [ALL_SECTIONS, ...sections.map((s) => s.label)], [sections]);
  const needing = progress?.needing ?? [];
  const needingShown = showAllNeeding ? needing : needing.slice(0, 8);

  return (
    <div>
      <PageHeader
        title="Allergens"
        subtitle={current ? `${venueName} · ${progressLine(current.progress)}` : "What each guest can eat, dish by dish"}
      />
      <AllergenTabs current="matrix" venueSlug={venue?.slug} />
      <VenueFilter className="mb-3" stats={false} compact />

      {!current ? (
        <VenueOverview perVenue={perVenue} onPick={setVenue} ready={store.ready} />
      ) : current.rows.length === 0 ? (
        <Empty title="No Food Dishes Yet" body={`${venueName} has no active food dishes. Add dishes on the Menu page and they appear here.`} />
      ) : (
        <>
          {sections.length > 1 ? (
            <Chips
              className="mb-3"
              ariaLabel="Menu section"
              value={section}
              onChange={setSection}
              options={[{ value: ALL, label: "All Sections" }, ...sections.map((s) => ({ value: s.label, label: s.label }))]}
            />
          ) : null}

          <div className="mb-4 flex flex-wrap items-center gap-2">
            {section !== ALL ? (
              <Link href={matrixPrintHref(venue!.slug, section)} className="btn-plain !min-h-[44px] !px-4 !text-[15px]">
                <Printer className="h-4 w-4" strokeWidth={2.25} /> Print This Section
              </Link>
            ) : null}
            <Link href={matrixPrintHref(venue!.slug, null)} className="btn-plain !min-h-[44px] !px-4 !text-[15px]">
              <Printer className="h-4 w-4" strokeWidth={2.25} /> Print All Sections
            </Link>
            <Link href={`/matrix/todo?venue=${venue!.slug}`} className="btn-plain !min-h-[44px] !px-4 !text-[15px]">
              <ListChecks className="h-4 w-4" strokeWidth={2.25} /> To Do List{waiting ? ` (${waiting})` : ""}
            </Link>
            <Link href="/allergens" className="btn-text !min-h-[44px]">
              Menu Labels
            </Link>
          </div>

          {venue && matrixPrints ? (
            <PrintStatusBlock className="mb-3" status={printStatus(matrixPrints, venue.id, section === ALL ? ALL_SECTIONS : section, current.rows, (id) => itemName.get(id) ?? null)} venueSlug={venue.slug} sheetKey={section === ALL ? ALL_SECTIONS : section} />
          ) : null}

          <MatrixLegend className="mb-4" />

          <MatrixTable sections={shown} showSectionHeads={section === ALL && sections.length > 1} />

          {/* phones and tablets: a card per dish */}
          <div className="lg:hidden">
            {shown.map((s) => (
              <section key={s.label} className="mb-5">
                {section === ALL && sections.length > 1 ? <h2 className="px-1 pb-2 text-[13px] font-medium text-label-2">{s.label}</h2> : null}
                <div className="grid gap-3 md:grid-cols-2">
                  {s.rows.map((r) => (
                    <DishCard key={r.dish.id} row={r} />
                  ))}
                </div>
              </section>
            ))}
          </div>

          {progress && progress.confirmed < progress.total ? (
            <div className="mt-6">
              <Group
                title={`Needs Confirming (${needing.length})`}
                className="mt-0"
                footer="A dish that is not confirmed shows Not checked on the sheet and on the kitchen iPad. A dish whose ingredients changed after it was signed off needs a re-check. Open the dish and press Confirm Allergens, or use the To Do list to go through them one by one."
              >
                {needingShown.map((r) => (
                  <Row key={r.dish.id} href={`/items/${r.dish.id}`} title={r.dish.name} sub={r.dish.section ?? undefined} trailing={<span className="text-[13px] font-semibold text-warn">{r.signOff === "changed" || r.signOff === "legacy" ? "Re-check" : "Not confirmed"}</span>} chevron />
                ))}
              </Group>
              {needing.length > 8 ? (
                <button type="button" className="btn-text mt-1 !min-h-[44px]" onClick={() => setShowAllNeeding((x) => !x)}>
                  {showAllNeeding ? "Show Fewer" : `Show All (${needing.length})`}
                </button>
              ) : null}
            </div>
          ) : (
            <p className="mb-4 text-[15px] font-medium text-good">Every dish is confirmed.</p>
          )}

          {venue && matrixPrints ? (
            <div className="mt-6">
              <Group title="Printed Sheets" className="mt-0" footer="Each print gets a version number. If a dish changes after a sheet is printed, the sheet says so here and you can print it again.">
                {sheetKeys.map((k) => (
                  <div key={k} className="px-4 py-2.5">
                    <p className="text-[17px] font-medium sm:text-[15px]">{sheetName(k)}</p>
                    <PrintStatusBlock status={printStatus(matrixPrints, venue.id, k, current.rows, (id) => itemName.get(id) ?? null)} venueSlug={venue.slug} sheetKey={k} />
                  </div>
                ))}
              </Group>
            </div>
          ) : null}

          <p className="mt-3 text-[13px] text-label-2">
            {shownRows.length} {shownRows.length === 1 ? "dish" : "dishes"} shown. Read only: to change an answer, change the dish. Gluten Free, Vegetarian and Vegan come from the dish&rsquo;s marks and options. Soy and Lupin have no column; they are listed on the dish card.
          </p>
        </>
      )}
    </div>
  );
}

/** With All chosen: each venue's progress, tap to open it. */
function VenueOverview({ perVenue, onPick, ready }: { perVenue: { venue: { id: number; slug: string; name: string }; rows: unknown[]; progress: { total: number; confirmed: number } }[]; onPick: (slug: string) => void; ready: boolean }) {
  const withDishes = perVenue.filter((p) => p.progress.total > 0);
  if (!ready) return null;
  if (!withDishes.length) return <Empty title="No Food Dishes Yet" body="Add dishes on the Menu page and they appear here." />;
  return (
    <Group title="Choose A Venue" className="mt-2" footer="Each venue has its own matrix, so nothing is mixed between kitchens.">
      {withDishes.map((p) => (
        <Row
          key={p.venue.id}
          onClick={() => onPick(p.venue.slug)}
          title={VENUE_SHORT[p.venue.slug] ?? p.venue.name}
          sub={progressLine(p.progress)}
          trailing={p.progress.confirmed === p.progress.total ? <span className="text-[13px] font-semibold text-good">All confirmed</span> : <span className="text-[13px] font-semibold text-warn">{p.progress.total - p.progress.confirmed} to confirm</span>}
          chevron
        />
      ))}
    </Group>
  );
}
