"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { useStore } from "@/lib/store";
import { parentKey } from "@/lib/costing";
import { buildDrinkRequest, isResearchCategory, researchWhy } from "@/lib/research-drink";
import { requestResearch } from "@/lib/research-drink-client";
import type { MenuItem } from "@/lib/types";
import { useToast } from "../ui";

/**
 * "Research This Drink": shown on the recipe page of a NEW cocktail or mocktail (cost_menu_items.research_status =
 * 'offered') until Troy researches it or skips it. One tap looks the drink up on the web and files the findings as
 * manager-only Research Notes, which are approved the usual way. It never edits the recipe.
 *
 * Everything here goes straight to the database through the store (research_status and the note inserts), never through the
 * editor's draft, so it never makes the page "unsaved" and never trips the leave prompt. It researches the SAVED recipe, so
 * while the page has unsaved edits the button waits for Save.
 */
type Phase = { step: "idle"; error?: string } | { step: "running" };

export function ResearchDrinkCard({ item, dirty }: { item: MenuItem; dirty: boolean }) {
  const store = useStore();
  const storeRef = useRef(store);
  storeRef.current = store;
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const [seconds, setSeconds] = useState(0);
  const [busySkip, setBusySkip] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abort.current?.abort(); // leaving the page ends the research; nothing is saved from a run that did not finish
    };
  }, []);
  const running = phase.step === "running";
  useEffect(() => {
    if (!running) return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  const lines = store.index.linesByParent.get(parentKey("item", item.id)) ?? [];
  const existingTitles = useMemo(() => store.researchNotes.filter((n) => n.item_id === item.id).map((n) => n.title), [store.researchNotes, item.id]);
  const request = useMemo(() => buildDrinkRequest(item, lines, store.index, existingTitles), [item, lines, store.index, existingTitles]);

  if (item.research_status !== "offered" || !isResearchCategory(item.category)) return null;

  const failed = phase.step === "idle" ? phase.error : undefined;
  const blocked = dirty ? "Save your changes first, so the research reads the saved recipe." : !request ? "Add the ingredients and Save first, so there is a recipe to look up." : null;

  async function research() {
    if (!request || dirty || running) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setPhase({ step: "running" });
    const answer = await requestResearch(request, ctl.signal);
    if (!alive.current) return;
    if (!answer.ok) {
      setPhase(answer.reason === "cancelled" ? { step: "idle" } : { step: "idle", error: answer.message });
      return;
    }
    try {
      const saved = await storeRef.current.addResearchNotes(item.id, answer.notes);
      await storeRef.current.setResearchOffer(item.id, "done");
      toastRef.current.show({ message: saved.length ? `Research done. ${saved.length} ${saved.length === 1 ? "note" : "notes"} to review below.` : "Research done. Nothing worth flagging against the usual recipe." });
    } catch (e) {
      if (alive.current) setPhase({ step: "idle", error: `The research ran, but it could not be saved. ${e instanceof Error ? e.message : ""}`.trim() });
    }
  }

  async function skip() {
    setBusySkip(true);
    try {
      await storeRef.current.setResearchOffer(item.id, "skipped");
      toastRef.current.show({ message: "Skipped. This card will not come back." });
    } catch (e) {
      if (alive.current) {
        setBusySkip(false);
        setPhase({ step: "idle", error: e instanceof Error ? e.message : researchWhy("server") });
      }
    }
  }

  return (
    <section className="mt-6" aria-label="Research This Drink">
      <div className="rounded-2xl bg-surface px-4 py-4">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
            <Search className="h-[18px] w-[18px]" strokeWidth={2.25} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-semibold leading-snug">Research This Drink</h2>
            <p className="mt-1 text-[15px] leading-snug text-label-2 sm:max-w-[60ch]">Looks up how this drink is usually made and files notes for you to review. Nothing changes until you approve a note. Takes about a minute.</p>
          </div>
        </div>

        {running ? (
          <div className="mt-4 flex flex-wrap items-center gap-3" role="status" aria-live="polite">
            <Loader2 className="h-[18px] w-[18px] shrink-0 animate-spin text-accent" aria-hidden />
            <p className="min-w-0 flex-1 text-[15px] text-label-2">
              Searching the web for {item.name}
              <span className="tnum"> · {seconds} s</span>
              <span className="block text-[13px] text-label-3">Stay on this page until it finishes.</span>
            </p>
            <button type="button" className="btn-plain" onClick={() => abort.current?.abort()}>
              Cancel
            </button>
          </div>
        ) : (
          <>
            {failed ? (
              <p role="alert" className="mt-4 rounded-xl bg-danger-soft px-3 py-2.5 text-[15px] leading-snug text-danger sm:max-w-[68ch]">
                {failed}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button type="button" className="btn-primary min-w-0 flex-1 sm:flex-none sm:px-6" disabled={!!blocked || busySkip} onClick={() => void research()}>
                {failed ? "Try Again" : "Research This Drink"}
              </button>
              <button type="button" className="btn-plain px-5" disabled={busySkip} onClick={() => void skip()}>
                {busySkip ? "Skipping…" : "Skip"}
              </button>
            </div>
            <p className="mt-2.5 text-[13px] leading-snug text-label-2">{blocked ?? "Skip removes this card for good and adds no notes."}</p>
          </>
        )}
      </div>
    </section>
  );
}
