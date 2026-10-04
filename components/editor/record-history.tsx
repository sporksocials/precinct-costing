"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { describeHistoryRow, type HistoryRow } from "@/lib/change-history";
import { brisbaneDayLabel, brisbaneTime } from "@/lib/change-log";
import { creationRow, historyChildWord, loadRecordHistory, recordStatusLines, type RecordStamps } from "@/lib/record-created";
import { applyPlanToLines, applyPlanToRecord, planUndo, recordEventsForTable, visibleEvents, type RecordEvent, type RecordKind, type UndoPlan } from "@/lib/undo-change";
import type { MenuItem, Prep, RecipeLine } from "@/lib/types";
import { Group, Sheet, useToast } from "../ui";
import { useHistoryLookups } from "../use-history-lookups";
import { usePersonName } from "../use-person-name";

type Rec = MenuItem | Prep;

/** How long a reload after an edit waits for the database to answer. */
const RELOAD_DELAY_MS = 900;

/** Undo This Change, offered only on dishes, drinks and preps: it loads the earlier values into the recipe editor's draft. */
export interface HistoryUndo {
  kind: RecordKind;
  draft: Rec;
  lines: RecipeLine[];
  setDraft: (fn: (d: Rec) => Rec) => void;
  setLines: (fn: (l: RecipeLine[]) => RecipeLine[]) => void;
}

/**
 * The History group, one component for every record page. It starts with who created the record (and who last changed
 * it), then the latest events for the record and its child rows (recipe lines, serve prices, packaging, offer components).
 * Read only, except where `undo` is given (dishes, drinks, preps): Undo never writes, it loads the earlier values into the
 * editor's draft and the normal Save bar, leave guard and conflict check take over.
 *
 * `table` is the record's cost_* table and `rowKey` its id; `label` is the word the footer uses ("tap beer", "offer").
 * `embedded` drops the group chrome for use inside another row (a deal on the ingredient page).
 */
export function RecordHistory({
  table,
  rowKey,
  label = "record",
  undo,
  refreshKey,
  embedded,
}: {
  table: string;
  rowKey: string;
  label?: string;
  undo?: HistoryUndo;
  /** changes after each save (the record's updated_at), so the list reloads */
  refreshKey?: string | null;
  embedded?: boolean;
}) {
  const store = useStore();
  const lk = useHistoryLookups();
  const nameOf = usePersonName();
  const toast = useToast();
  const [data, setData] = useState<{ rows: HistoryRow[]; stamps: RecordStamps | null; historyKnown: boolean } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState<{ event: RecordEvent; plan: UndoPlan } | null>(null);

  // The first load is immediate. A later change of refreshKey comes from an edit the page has just sent (the store updates
  // before the database has answered), so the reload waits a moment to see the new row.
  const loadedOnce = useRef(false);
  useEffect(() => {
    let live = true;
    const run = () =>
      loadRecordHistory(getSupabaseBrowser(), table, rowKey)
        .then((r) => {
          loadedOnce.current = true;
          if (live) setData(r);
        })
        .catch(() => live && setData({ rows: [], stamps: null, historyKnown: false }));
    const timer = setTimeout(run, loadedOnce.current ? RELOAD_DELAY_MS : 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [table, rowKey, refreshKey]);

  const rows = data?.rows ?? null;
  // The record's own first insert is the Created line, so it is not repeated as an event.
  const created = useMemo(() => (rows ? creationRow(rows, table, rowKey) : null), [rows, table, rowKey]);
  const events = useMemo(
    () => (rows ? recordEventsForTable(rows.filter((r) => r.id !== created?.id), table, rowKey, (r) => describeHistoryRow(r, lk)) : []),
    [rows, created, table, rowKey, lk],
  );
  const { shown, canExpand } = visibleEvents(events, expanded);
  const status = useMemo(() => (data ? recordStatusLines({ rows: data.rows, table, key: rowKey, stamps: data.stamps, nameOf, historyKnown: data.historyKnown }) : null), [data, table, rowKey, nameOf]);

  const ask = (event: RecordEvent) => {
    if (!undo) return;
    const plan = planUndo(event.row, event.scope, {
      kind: undo.kind,
      id: rowKey,
      record: undo.draft as unknown as Record<string, unknown>,
      lines: undo.lines,
      history: rows ?? [],
      ingredientName: (i) => store.ingredients.find((x) => x.id === i)?.name,
      prepName: (i) => store.preps.find((x) => x.id === i)?.name,
    });
    setPending({ event, plan });
  };
  const load = () => {
    if (!pending || !undo) return;
    const { plan } = pending;
    undo.setDraft((d) => applyPlanToRecord(d as unknown as Record<string, unknown>, plan) as unknown as Rec);
    undo.setLines((ls) => applyPlanToLines(ls, plan));
    setPending(null);
    toast.show({ message: "Loaded into the editor. Tap Save to keep it." }, 7000);
  };

  if (rows == null || status == null) return null;
  const when = (at: string) => `${brisbaneDayLabel(at)}, ${brisbaneTime(at)}`;
  const plan = pending?.plan;
  const childWord = historyChildWord(table);
  const body = (
    <>
      {status.created ? (
        <div className="px-4 py-3" data-testid="history-created">
          <p className="break-words text-[15px] font-medium leading-snug text-label">{status.created}</p>
          {status.lastChanged ? <p className="mt-0.5 break-words text-[15px] leading-snug text-label-2">{status.lastChanged}</p> : null}
        </div>
      ) : status.lastChanged ? (
        <div className="px-4 py-3">
          <p className="break-words text-[15px] leading-snug text-label-2">{status.lastChanged}</p>
        </div>
      ) : null}
      {events.length === 0 ? (
        <div className="px-4 py-3.5 text-[15px] text-label-2">No changes recorded yet.</div>
      ) : (
        shown.map((e) => (
          <div key={e.key} className="flex min-h-[48px] items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="break-words text-[15px] leading-snug text-label">{e.summary}</p>
              <p className="text-[13px] text-label-2">
                {e.who ? nameOf(e.who) ?? e.who : "Database"} · {when(e.at)}
              </p>
            </div>
            {undo && e.canUndo ? (
              <button type="button" className="btn-text shrink-0 font-semibold" onClick={() => ask(e)}>
                Undo This Change
              </button>
            ) : null}
          </div>
        ))
      )}
      {canExpand ? (
        <div className="px-4">
          <button type="button" className="btn-text font-semibold" onClick={() => setExpanded((x) => !x)}>
            {expanded ? "Show Fewer" : "Show More"}
          </button>
        </div>
      ) : null}
    </>
  );
  return (
    <>
      {embedded ? (
        <div className="mx-4 mb-3 divide-y divide-[color:var(--separator)] rounded-xl bg-fill" data-testid="record-history">
          {body}
        </div>
      ) : (
        <Group title="History" className="mt-7" footer={`The latest changes to this ${label}${childWord ? ` and its ${childWord}` : ""}. Brisbane time.`}>
          {body}
        </Group>
      )}
      {undo ? (
        <Sheet
          open={!!pending}
          onClose={() => setPending(null)}
          title="Undo This Change"
          action={plan?.undoable ? { label: "Load Into Editor", onClick: load } : undefined}
          cancelLabel={plan?.undoable ? "Cancel" : "Close"}
        >
          {pending && plan ? (
            <div className="space-y-3 px-5 pb-4 pt-1 text-[15px] leading-snug">
              <p className="text-label-2">{pending.event.summary}</p>
              {plan.blocked ? (
                <p className="rounded-xl bg-danger-soft px-3.5 py-3 font-medium text-danger" role="alert">
                  {plan.blocked}
                </p>
              ) : (
                plan.impact.map((s) => (
                  <p key={s} className="font-semibold text-label">
                    {s}
                  </p>
                ))
              )}
              {plan.warnings.map((w) => (
                <p key={w} className="rounded-xl bg-fill px-3.5 py-3 font-medium text-warn">
                  {w}
                </p>
              ))}
              {plan.undoable ? <p className="text-[13px] text-label-2">Nothing is saved yet. This loads the earlier values into the editor so you can check them, then tap Save to keep them.</p> : null}
            </div>
          ) : null}
        </Sheet>
      ) : null}
    </>
  );
}
