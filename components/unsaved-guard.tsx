"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { UnsavedGuard } from "@/lib/unsaved-guard";
import { Banner, Sheet } from "./ui";

/**
 * Leave guard for pages that hold unsaved edits (see lib/unsaved-guard.ts for how it works).
 * Mount `UnsavedGuardProvider` once inside the app shell. A page calls `useUnsavedGuard(dirty, { save })`; code that
 * navigates on its own calls `useGuardedRouter()` instead of `useRouter()` so it asks first too.
 */

const noopSubscribe = () => () => {};
const noPrompt = () => null;
const Ctx = createContext<UnsavedGuard | null>(null);

export function UnsavedGuardProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  // the server render has no window; the guard only matters once the page is live in a browser
  const guard = useMemo(
    () =>
      typeof window === "undefined"
        ? null
        : new UnsavedGuard({
            win: window,
            doc: document,
            history: window.history,
            get location() {
              return window.location;
            },
            navigate: (href, replace) => (replace ? routerRef.current.replace(href) : routerRef.current.push(href)),
          }),
    [],
  );
  const prompt = useSyncExternalStore(guard?.subscribe ?? noopSubscribe, guard?.getPrompt ?? noPrompt, noPrompt);
  return (
    <Ctx.Provider value={guard}>
      {children}
      <Sheet open={!!prompt} onClose={() => guard?.keepEditing()} hideHeader size="sm">
        <div className="pb-2 pt-5 text-center">
          <p className="text-[20px] font-semibold">Unsaved Changes</p>
          <p className="mx-auto mt-1.5 max-w-xs text-[15px] text-label-2">You have changes on this page that are not saved yet.</p>
          {prompt?.error ? <Banner>{prompt.error}</Banner> : null}
          <div className="mt-5 space-y-2">
            <button type="button" className="btn-primary w-full" disabled={prompt?.busy} onClick={() => void guard?.saveAndLeave()}>
              {prompt?.busy ? "Saving…" : "Save And Leave"}
            </button>
            <button type="button" className="btn w-full bg-danger-soft text-danger" disabled={prompt?.busy} onClick={() => guard?.leaveWithoutSaving()}>
              Leave Without Saving
            </button>
            <button type="button" className="btn-plain w-full" disabled={prompt?.busy} onClick={() => guard?.keepEditing()}>
              Keep Editing
            </button>
          </div>
        </div>
      </Sheet>
    </Ctx.Provider>
  );
}

/**
 * Guard this page while `dirty`. `save` must resolve true only when everything is saved (false keeps the person here
 * with the three choices still showing); `getError` can supply the reason for that message.
 * Returns `release`, to call just before navigating away on purpose after the edits stopped mattering (a delete).
 */
export function useUnsavedGuard(dirty: boolean, opts: { save: () => Promise<boolean>; getError?: () => string | null }) {
  const guard = useContext(Ctx);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  useEffect(() => {
    if (!guard) return;
    return guard.register(
      () => optsRef.current.save(),
      () => optsRef.current.getError?.() ?? null,
    );
  }, [guard]);
  useEffect(() => {
    guard?.setDirty(dirty);
  }, [guard, dirty]);
  const release = useCallback(() => (guard ? guard.release() : Promise.resolve()), [guard]);
  /** closes the "Unsaved Changes" prompt (and keeps the person on the page), e.g. once a clash found by Save And Leave is settled */
  const dismissPrompt = useCallback(() => guard?.keepEditing(), [guard]);
  return { release, dismissPrompt };
}

/** `useRouter` for code that navigates away from a page that may hold unsaved edits: push asks first when it does. */
export function useGuardedRouter() {
  const guard = useContext(Ctx);
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  return useMemo(
    () => ({
      push: (href: string) => {
        if (!guard || guard.request(href)) routerRef.current.push(href);
      },
      replace: (href: string, opts?: { scroll?: boolean }) => routerRef.current.replace(href, opts),
    }),
    [guard],
  );
}
