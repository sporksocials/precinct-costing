"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Undo2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { fetchChangeHistory, namesFromHistory, type HistoryRow } from "@/lib/change-history";
import { RESTORABLE, TRASH_PAGE, TRASH_TYPES, buildTrash, deletedByLabel, deletedWhen, matchesTrash, planRestore, withChildren, type LiveView, type RestorePlan, type Row, type TrashEntry, type TrashType } from "@/lib/trash";
import { DataTable, type Column } from "@/components/table";
import { VenueFilter, VENUE_SHORT, useVenue } from "@/components/venue";
import { Chips, Empty, ListSkeleton, PageHeader, SearchField, useToast } from "@/components/ui";
import { usePersonName } from "@/components/use-person-name";
import { RestoreSheet } from "@/components/restore-sheet";

/** Every delete row, newest first, a page at a time (deletes are rare, so a few pages is plenty). */
async function fetchDeletes(): Promise<{ rows: HistoryRow[]; note: string | null }> {
  const sb = getSupabaseBrowser();
  const rows: HistoryRow[] = [];
  for (let page = 0; page < 6; page++) {
    const r = await fetchChangeHistory(sb, { op: "delete", limit: 1000, offset: rows.length });
    if (r.error) return { rows, note: `Trash could not be loaded in full (${r.error}).` };
    rows.push(...r.rows);
    if (!r.hasMore) return { rows, note: null };
  }
  return { rows, note: "Showing the most recent deleted items." };
}

export default function TrashPage() {
  const store = useStore();
  const nameOf = usePersonName();
  const toast = useToast();
  const router = useRouter();
  const { venue, slug } = useVenue();
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [type, setType] = useState<TrashType | "all">("all");
  const [pages, setPages] = useState(1);
  const [plan, setPlan] = useState<RestorePlan | null>(null);

  const load = useCallback(() => {
    setRows(null);
    void fetchDeletes().then((r) => {
      setRows(r.rows);
      setNote(r.note);
    });
  }, []);
  useEffect(load, [load]);
  useEffect(() => setPages(1), [q, type, slug]);

  const live = useMemo<LiveView>(() => {
    const byTable: Record<string, readonly Row[]> = {
      cost_menu_items: store.storedItems as unknown as Row[],
      cost_preps: store.preps as unknown as Row[],
      cost_beers: store.beers as unknown as Row[],
      cost_gelato_serves: store.gelatoServes as unknown as Row[],
      cost_offers: store.offers as unknown as Row[],
      cost_ingredient_deals: store.deals as unknown as Row[],
      cost_ingredients: store.ingredients as unknown as Row[],
      cost_beer_serves: store.beerServes as unknown as Row[],
    };
    const ids = new Map(Object.entries(byTable).map(([t, list]) => [t, new Set(list.map((r) => String(r.id)))]));
    return { has: (t, k) => ids.get(t)?.has(k) ?? false, rows: (t) => [...(byTable[t] ?? [])] };
  }, [store.storedItems, store.preps, store.beers, store.gelatoServes, store.offers, store.deals, store.ingredients, store.beerServes]);

  const names = useMemo(() => namesFromHistory(rows ?? []), [rows]);
  const ingredientName = useCallback((id: string) => store.ingredients.find((i) => i.id === id)?.name ?? names.get(`cost_ingredients|${id}`), [store.ingredients, names]);
  const entries = useMemo(() => (rows ? buildTrash(rows, live.has, ingredientName) : []), [rows, live, ingredientName]);
  const shown = useMemo(() => entries.filter((e) => matchesTrash(e, q, type, venue?.id ?? null)), [entries, q, type, venue]);
  const visible = shown.slice(0, pages * TRASH_PAGE);
  const typeOptions = useMemo(() => [{ value: "all" as const, label: "All" }, ...TRASH_TYPES.filter((t) => entries.some((e) => e.type === t)).map((t) => ({ value: t, label: t }))], [entries]);

  const planFor = (e: TrashEntry) =>
    planRestore(e, live, {
      venueName: (id) => store.venueById.get(id) && (VENUE_SHORT[store.venueById.get(id)!.slug] ?? store.venueById.get(id)!.name),
      nameOf: (t, k) => (t === "cost_ingredients" ? ingredientName(k) : t === "cost_preps" ? store.preps.find((p) => p.id === k)?.name : names.get(`${t}|${k}`)),
    });

  const confirm = async (p: RestorePlan) => {
    const r = await store.restoreDeleted(p);
    const href = RESTORABLE[p.parentTable].href(p.entry.key);
    const problems = r.failed.length + p.skipped.length;
    toast.show({
      message: problems ? `Restored ${p.entry.name}. ${problems} ${problems === 1 ? "line" : "lines"} could not be restored.` : `Restored ${p.entry.name}.`,
      action: { label: "Open", onClick: () => router.push(href) },
    }, 8000);
    setRows((cur) => cur && [...cur]); // the store now holds it, so the list drops it
  };

  const who = (e: TrashEntry) => deletedByLabel(e.deletedBy, nameOf);
  const venueText = (e: TrashEntry) => (e.venueId != null && store.venueById.get(e.venueId) ? VENUE_SHORT[store.venueById.get(e.venueId)!.slug] ?? store.venueById.get(e.venueId)!.name : "");
  const restoreButton = (e: TrashEntry) => (
    <button type="button" className="btn-tinted shrink-0" onClick={() => setPlan(planFor(e))} aria-label={`Restore ${e.name}`}>
      <Undo2 className="h-4 w-4" strokeWidth={2.25} /> Restore
    </button>
  );

  const columns: Column<TrashEntry>[] = [
    { key: "name", label: "Name", sort: (e) => e.name, className: "!whitespace-normal min-w-[14rem]", render: (e) => <span className="block font-medium">{e.name}</span> },
    { key: "type", label: "Type", sort: (e) => e.type, render: (e) => <span className="text-label-2">{[e.type, venueText(e)].filter(Boolean).join(" · ")}</span> },
    { key: "who", label: "Deleted By", sort: (e) => who(e), render: (e) => <span className="text-[13px]">{who(e)}</span> },
    { key: "when", label: "When", sort: (e) => e.deletedAt, render: (e) => <span className="text-[13px]">{deletedWhen(e.deletedAt)}</span> },
    { key: "with", label: "Came With", render: (e) => <span className="text-[13px] text-label-2">{withChildren(e) || "Nothing else"}</span> },
    { key: "act", label: "", align: "right", render: restoreButton },
  ];

  const loading = rows == null;
  const filtering = q.trim() !== "" || type !== "all" || slug !== "all";

  return (
    <div>
      <PageHeader
        title="Trash"
        subtitle="Restore anything that was deleted"
        trailing={
          <button type="button" className="btn-plain" onClick={load}>
            <RefreshCw className="h-4 w-4" strokeWidth={2.25} /> Refresh
          </button>
        }
      />
      <div className="mt-3">
        <VenueFilter stats={false} compact />
      </div>
      <div className="mt-3 space-y-3">
        <SearchField value={q} onChange={setQ} placeholder="Search deleted items" />
        {typeOptions.length > 2 ? <Chips ariaLabel="Type" options={typeOptions} value={type} onChange={setType} /> : null}
      </div>
      {note ? (
        <p className="mt-3 text-[13px] text-warn" role="status">
          {note}
        </p>
      ) : null}

      {loading ? (
        <div className="mt-6">
          <ListSkeleton rows={5} />
        </div>
      ) : shown.length === 0 ? (
        filtering && entries.length > 0 ? <Empty title="No Matching Items" body="Try another type, venue or search." /> : <Empty title="Trash Is Empty" body="Deleted items appear here and can be restored." />
      ) : (
        <>
          <div className="group-list mt-6 lg:hidden">
            {visible.map((e) => (
              <div key={e.id} className="flex min-h-[64px] items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-[17px] font-medium leading-snug">{e.name}</p>
                  <p className="text-[13px] text-label-2">{[e.type, venueText(e)].filter(Boolean).join(" · ")}</p>
                  <p className="text-[13px] text-label-2">
                    Deleted by {who(e)} · {deletedWhen(e.deletedAt)}
                  </p>
                  {withChildren(e) ? <p className="text-[13px] text-label-2">{withChildren(e)}</p> : null}
                </div>
                {restoreButton(e)}
              </div>
            ))}
          </div>
          <div className="mt-6 hidden lg:block">
            <DataTable rows={visible} columns={columns} rowKey={(e) => e.id} initialSort={{ key: "when", dir: "desc" }} />
          </div>
          <p className="mt-2 text-[13px] text-label-2">
            Showing {visible.length} of {shown.length}.
          </p>
          {visible.length < shown.length ? (
            <div className="mt-3 flex justify-center">
              <button type="button" className="btn-plain" onClick={() => setPages((p) => p + 1)}>
                Show More
              </button>
            </div>
          ) : null}
        </>
      )}
      <RestoreSheet plan={plan} onClose={() => setPlan(null)} onConfirm={confirm} />
    </div>
  );
}
