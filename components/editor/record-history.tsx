"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { describeHistoryRow, fetchChangeHistory, type HistoryRow } from "@/lib/change-history";
import { brisbaneDayLabel, brisbaneTime } from "@/lib/change-log";
import { RECORD_TABLE, applyPlanToLines, applyPlanToRecord, planUndo, recordEvents, visibleEvents, type RecordEvent, type RecordKind, type UndoPlan } from "@/lib/undo-change";
import type { MenuItem, Prep, RecipeLine } from "@/lib/types";
import { Group, Sheet, useToast } from "../ui";
import { useHistoryLookups } from "../use-history-lookups";
import { usePersonName } from "../use-person-name";

type Rec = MenuItem | Prep;

/** How many rows of each kind (the record's own, its lines') are fetched; the group shows 10 and Show More the rest. */
const LOAD = 60;

/** The record's own history rows plus its recipe lines' rows, newest first. A failure or missing table is just "no history". */
async function loadHistory(kind: RecordKind, id: string): Promise<HistoryRow[]> {
  const sb = getSupabaseBrowser();
  const [own, lines] = await Promise.all([
    fetchChangeHistory(sb, { table: RECORD_TABLE[kind], rowKey: id, limit: LOAD }),
    fetchChangeHistory(sb, { parentTable: RECORD_TABLE[kind], parentId: id, limit: LOAD }),
  ]);
  const seen = new Set<string>();
  return [...own.rows, ...lines.rows].filter((r) => (seen.has(String(r.id)) ? false : (seen.add(String(r.id)), true)));
}

/**
 * History group on a dish, drink or prep: the latest events for the record and its recipe lines, with Undo This Change.
 * Undo never writes: it loads the earlier values into the editor's draft (setDraft / setLines) and the normal Save bar,
 * leave guard and conflict check take over.
 */
export function RecordHistory({
  kind,
  id,
  draft,
  lines,
  setDraft,
  setLines,
  refreshKey,
}: {
  kind: RecordKind;
  id: string;
  draft: Rec;
  lines: RecipeLine[];
  setDraft: (fn: (d: Rec) => Rec) => void;
  setLines: (fn: (l: RecipeLine[]) => RecipeLine[]) => void;
  /** changes after each save (the record's updated_at), so the list reloads */
  refreshKey?: string | null;
}) {
  const store = useStore();
  const lk = useHistoryLookups();
  const nameOf = usePersonName();
  const toast = useToast();
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState<{ event: RecordEvent; plan: UndoPlan } | null>(null);

  useEffect(() => {
    let live = true;
    loadHistory(kind, id)
      .then((r) => live && setRows(r))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [kind, id, refreshKey]);

  const events = useMemo(() => (rows ? recordEvents(rows, kind, id, (r) => describeHistoryRow(r, lk)) : []), [rows, kind, id, lk]);
  const { shown, canExpand } = visibleEvents(events, expanded);

  const ask = (event: RecordEvent) => {
    const plan = planUndo(event.row, event.scope, {
      kind,
      id,
      record: draft as unknown as Record<string, unknown>,
      lines,
      history: rows ?? [],
      ingredientName: (i) => store.ingredients.find((x) => x.id === i)?.name,
      prepName: (i) => store.preps.find((x) => x.id === i)?.name,
    });
    setPending({ event, plan });
  };
  const load = () => {
    if (!pending) return;
    const { plan } = pending;
    setDraft((d) => applyPlanToRecord(d as unknown as Record<string, unknown>, plan) as unknown as Rec);
    setLines((ls) => applyPlanToLines(ls, plan));
    setPending(null);
    toast.show({ message: "Loaded into the editor. Tap Save to keep it." }, 7000);
  };

  if (rows == null) return null;
  const when = (at: string) => `${brisbaneDayLabel(at)}, ${brisbaneTime(at)}`;
  const plan = pending?.plan;
  return (
    <>
      <Group title="History" className="mt-7" footer="The latest changes to this record and its ingredients. Brisbane time.">
        {events.length === 0 ? (
          <div className="px-4 py-3.5 text-[15px] text-label-2">No history yet</div>
        ) : (
          shown.map((e) => (
            <div key={e.key} className="flex min-h-[48px] items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="break-words text-[15px] leading-snug text-label">{e.summary}</p>
                <p className="text-[13px] text-label-2">
                  {e.who ? nameOf(e.who) ?? e.who : "Database"} · {when(e.at)}
                </p>
              </div>
              {e.canUndo ? (
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
      </Group>
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
    </>
  );
}
