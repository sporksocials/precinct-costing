"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useStore } from "@/lib/store";
import { countByStatus, groupNotes, type NoteRecord } from "@/lib/research-notes";
import type { ResearchNote, ResearchStatus } from "@/lib/types";
import { useVenue, VenueFilter, VENUE_SHORT } from "@/components/venue";
import { ResearchNoteCard, useNoteEffects } from "@/components/editor/research-notes";
import { Chips, cx, Dot, Empty, Group, PageHeader } from "@/components/ui";
import { useUrlState } from "@/components/use-url-state";

type Filter = ResearchStatus | "all";

export default function ResearchNotesPage() {
  const store = useStore();
  const { venue } = useVenue();
  const [filterRaw, setFilterRaw] = useUrlState("filter", "open");
  const filter: Filter = filterRaw === "approved" || filterRaw === "dismissed" || filterRaw === "all" ? filterRaw : "open";
  const setFilter = (v: Filter) => setFilterRaw(v);

  const resolver = useMemo(() => {
    const items = new Map(store.items.map((i) => [i.id, i]));
    const preps = new Map(store.preps.map((p) => [p.id, p]));
    return (n: ResearchNote): NoteRecord | null => {
      if (n.item_id) {
        const i = items.get(n.item_id);
        return i ? { name: i.name, venueId: i.venue_id, href: `/items/${encodeURIComponent(i.id)}` } : null;
      }
      const p = n.prep_id ? preps.get(n.prep_id) : null;
      return p ? { name: p.name, venueId: p.venue_id, href: `/preps/${p.id}` } : null;
    };
  }, [store.items, store.preps]);

  // everything in the chosen venue (so the chip counts follow the venue), then the status filter
  const inVenue = useMemo(() => (venue ? store.researchNotes.filter((n) => resolver(n)?.venueId === venue.id) : store.researchNotes), [store.researchNotes, venue, resolver]);
  const counts = countByStatus(inVenue);
  const shown = useMemo(() => (filter === "all" ? inVenue : inVenue.filter((n) => n.status === filter)), [inVenue, filter]);
  const effects = useNoteEffects(shown);
  const venueOrder = useMemo(() => store.venues.map((v) => v.id), [store.venues]);
  const groups = useMemo(() => groupNotes(shown, resolver, venueOrder), [shown, resolver, venueOrder]);
  const openAll = store.researchNotes.filter((n) => n.status === "open").length;

  return (
    <div className="max-w-3xl">
      <PageHeader title="Research Notes" subtitle={store.researchNotes.length ? `${openAll} open across all venues` : undefined} />
      <VenueFilter className="mb-4" stats={false} />

      {store.researchNotes.length === 0 ? (
        <Empty title="No Research Notes Yet" body="Suggestions from research show up here once they are added to a recipe, with the cost and GP worked out." />
      ) : (
        <>
          <p className="px-1 text-[15px] text-label-2">Ideas from research, with the cost and GP effect at the menu price. Managers only: never shown on the drinks station. Approve shows what will change in the recipe first, then updates it when you tap Add or Apply. Undo puts it back.</p>
          <Chips
            ariaLabel="Status"
            className="mt-4"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "open" as const, label: `Open (${counts.open})` },
              { value: "approved" as const, label: `Approved (${counts.approved})` },
              { value: "dismissed" as const, label: `Dismissed (${counts.dismissed})` },
              { value: "all" as const, label: `All (${counts.all})` },
            ]}
          />

          {groups.length === 0 ? (
            <Empty title="Nothing Here" body={filter === "open" ? "No open notes for this venue. Pick Approved or All to see the rest." : "No notes match this filter."} />
          ) : (
            groups.map((vg) => {
              const v = store.venues.find((x) => x.id === vg.venueId);
              return (
                <section key={vg.venueId ?? "none"} className="mt-8">
                  <h2 className="flex items-center gap-2 px-1 text-[17px] font-semibold">
                    {v ? <Dot className={cx(`v-${v.slug}`, "bg-accent-fill")} /> : null}
                    {v ? VENUE_SHORT[v.slug] ?? v.name : "Shared"}
                    <span className="text-[15px] font-normal text-label-2 tnum">
                      {vg.count} {vg.count === 1 ? "Note" : "Notes"}
                    </span>
                  </h2>
                  {vg.drinks.map((d) => (
                    <Group
                      key={d.key}
                      className="mt-3"
                      title={
                        d.href ? (
                          <Link href={d.href} className="inline-flex min-h-[36px] items-center gap-0.5 text-[15px] font-semibold text-label hover:text-accent sm:min-h-0">
                            {d.name}
                            <ChevronRight className="h-4 w-4 text-label-3" strokeWidth={2.5} aria-hidden />
                          </Link>
                        ) : (
                          <span className="text-[15px] font-semibold text-label-2">{d.name}</span>
                        )
                      }
                    >
                      {d.notes.map((n) => (
                        <ResearchNoteCard key={n.id} note={n} effect={effects.get(n.id)} recipeHref={d.href} />
                      ))}
                    </Group>
                  ))}
                </section>
              );
            })
          )}
        </>
      )}
    </div>
  );
}
