"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { ChevronRight, ExternalLink } from "lucide-react";
import { useStore } from "@/lib/store";
import { parentKey } from "@/lib/costing";
import { formatQty } from "@/lib/parse-qty";
import { effectTone, KIND_LABEL, notesForRecord, researchNoteEffect, safeUrl, type NoteEffect } from "@/lib/research-notes";
import type { ResearchNote, ResearchStatus } from "@/lib/types";
import { cx, Group, useToast } from "../ui";

/** The cost and GP effect of each note, worked out against the live recipe and prices. */
export function useNoteEffects(notes: readonly ResearchNote[]): Map<string, NoteEffect> {
  const { items, index, settings, targets } = useStore();
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  return useMemo(() => {
    const out = new Map<string, NoteEffect>();
    for (const n of notes) {
      const item = n.item_id ? itemById.get(n.item_id) : null;
      if (n.item_id && !item) {
        out.set(n.id, { status: "text_only", text: "" });
        continue;
      }
      const lines = item ? index.linesByParent.get(parentKey("item", item.id)) ?? [] : [];
      out.set(n.id, researchNoteEffect({ changes: n.changes, item, lines, index, settings, targets }));
    }
    return out;
  }, [notes, itemById, index, settings, targets]);
}

const VERB: Record<ResearchStatus, string> = { open: "Reopened", approved: "Approved", dismissed: "Dismissed" };

/** Approve / dismiss / reopen: saved straight away, with an Undo toast that puts the previous status back. */
export function useNoteStatus() {
  const { setResearchNoteStatus } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const setStatus = useCallback(
    async (note: ResearchNote, next: ResearchStatus) => {
      const previous = note.status;
      const mark = (on: boolean) =>
        setBusy((b) => {
          const s = new Set(b);
          if (on) s.add(note.id);
          else s.delete(note.id);
          return s;
        });
      mark(true);
      try {
        await setResearchNoteStatus(note.id, next);
        toast.show({
          message: `${VERB[next]}: ${note.title}`,
          action: {
            label: "Undo",
            onClick: () => {
              setResearchNoteStatus(note.id, previous).catch(() => toast.show({ message: "Couldn’t undo. Try again." }));
            },
          },
        });
      } catch {
        toast.show({ message: "Couldn’t save that. Try again." });
      } finally {
        mark(false);
      }
    },
    [setResearchNoteStatus, toast],
  );
  return { setStatus, busy };
}

const STATUS_PILL: Record<Exclude<ResearchStatus, "open">, { label: string; className: string }> = {
  approved: { label: "Approved", className: "bg-good-soft text-good" },
  dismissed: { label: "Dismissed", className: "bg-fill text-label-2" },
};

const TONE: Record<"warn" | "good" | "neutral", string> = {
  warn: "bg-warn-soft text-warn",
  good: "bg-good-soft text-good",
  neutral: "bg-fill text-label-2",
};

/**
 * One research note: kind chip, title, body, the cost and GP effect, sources, and Approve / Dismiss (or Reopen).
 * Shared by the recipe page and the Research Notes review page. All controls are visible, none are tucked in a menu.
 */
export function ResearchNoteCard({
  note,
  effect,
  busy,
  onStatus,
  recipeHref,
}: {
  note: ResearchNote;
  effect: NoteEffect | undefined;
  busy: boolean;
  onStatus: (note: ResearchNote, next: ResearchStatus) => void;
  /** review page: link back to the recipe */
  recipeHref?: string | null;
}) {
  const sources = note.sources.map((s) => ({ label: s.label || s.url, url: safeUrl(s.url) })).filter((s): s is { label: string; url: string } => !!s.url);
  const tone = effect ? effectTone(effect) : "neutral";
  const dim = note.status === "dismissed";
  return (
    <article className={cx("px-4 py-4", dim && "opacity-75")} aria-label={note.title}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex h-[22px] items-center rounded-full bg-accent-soft px-2.5 text-[12px] font-semibold leading-none text-accent">{KIND_LABEL[note.kind]}</span>
        {note.status !== "open" ? <span className={cx("inline-flex h-[22px] items-center rounded-full px-2.5 text-[12px] font-semibold leading-none", STATUS_PILL[note.status].className)}>{STATUS_PILL[note.status].label}</span> : null}
      </div>
      <h3 className="mt-2 text-[17px] font-semibold leading-snug">{note.title}</h3>
      {note.body ? <p className="mt-1 whitespace-pre-line text-[15px] leading-snug text-label-2 sm:max-w-[68ch]">{note.body}</p> : null}

      {effect && effect.text ? (
        <div className={cx("mt-3 rounded-xl px-3 py-2.5 sm:max-w-[68ch]", TONE[tone])}>
          <p className="text-[15px] font-medium leading-snug">{effect.text}</p>
          {effect.status === "ok" && effect.changedLines?.length ? (
            <p className="mt-1 text-[13px] leading-snug opacity-90 tnum">
              {effect.changedLines.map((c) => `${c.name}: ${formatQty(c.from, c.unit)} to ${formatQty(c.to, c.unit)}`).join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}

      {sources.length ? (
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-label-2">
          <span>Sources</span>
          {sources.map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[32px] items-center gap-1 font-medium text-accent hover:underline sm:min-h-0">
              {s.label}
              <ExternalLink className="h-3 w-3" strokeWidth={2.25} aria-hidden />
            </a>
          ))}
        </p>
      ) : null}

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        {note.status === "open" ? (
          <>
            <button type="button" className="btn-primary flex-1 sm:flex-none sm:px-5" disabled={busy} onClick={() => onStatus(note, "approved")}>
              Approve
            </button>
            <button type="button" className="btn-plain flex-1 sm:flex-none sm:px-5" disabled={busy} onClick={() => onStatus(note, "dismissed")}>
              Dismiss
            </button>
          </>
        ) : (
          <button type="button" className="btn-plain flex-1 sm:flex-none sm:px-5" disabled={busy} onClick={() => onStatus(note, "open")}>
            Reopen
          </button>
        )}
        {recipeHref ? (
          <Link href={recipeHref} className="btn-text ml-auto hidden !gap-0 px-2 font-semibold sm:inline-flex">
            Open Recipe
            <ChevronRight className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden />
          </Link>
        ) : null}
      </div>
    </article>
  );
}

/** The "Research Notes" group on a menu item or prep page. Renders nothing when the record has no notes. */
export function RecordResearchNotes({ kind, id }: { kind: "item" | "prep"; id: string }) {
  const { researchNotes } = useStore();
  const notes = useMemo(() => notesForRecord(researchNotes, kind, id), [researchNotes, kind, id]);
  const effects = useNoteEffects(notes);
  const { setStatus, busy } = useNoteStatus();
  const [showDismissed, setShowDismissed] = useState(false);
  if (!notes.length) return null;
  const live = notes.filter((n) => n.status !== "dismissed");
  const dismissed = notes.filter((n) => n.status === "dismissed");
  const open = notes.filter((n) => n.status === "open").length;
  const card = (n: ResearchNote) => <ResearchNoteCard key={n.id} note={n} effect={effects.get(n.id)} busy={busy.has(n.id)} onStatus={(x, s) => void setStatus(x, s)} />;
  return (
    <Group
      title="Research Notes"
      className="mt-6"
      trailing={<span className="text-[13px] text-label-2 tnum">{open ? `${open} open` : "None open"}</span>}
      footer="Managers only. Never shown on the cocktail station. Approving an idea does not change the recipe."
    >
      {live.map(card)}
      {dismissed.length ? (
        <DismissedToggle count={dismissed.length} open={showDismissed} onToggle={() => setShowDismissed((s) => !s)} />
      ) : null}
      {showDismissed ? dismissed.map(card) : null}
    </Group>
  );
}

/** The visible "Dismissed (n)" row that opens the dismissed notes. */
export function DismissedToggle({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-h-[48px] w-full items-center gap-3 px-4 text-left transition-colors hover:bg-fill active:bg-fill">
      <span className="min-w-0 flex-1 text-[17px] text-label-2 sm:text-[15px]">Dismissed ({count})</span>
      <ChevronRight className={cx("h-[18px] w-[18px] shrink-0 text-label-3 transition-transform duration-200 ease-ios", open && "rotate-90")} strokeWidth={2.5} aria-hidden />
    </button>
  );
}
