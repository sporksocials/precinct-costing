"use client";

import { useCallback, useState } from "react";

export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * One quiet save line for the whole Invoices section (like the other settings: a field saves when it is left, no Save bar).
 * `track(promise)` moves the line through Saving..., Saved, or a plain error; a failed save rethrows nothing, the line says why.
 */
export function useSaveLine() {
  const [state, setState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const track = useCallback(async <T,>(p: Promise<T>): Promise<T | undefined> => {
    setState("saving");
    setMessage(null);
    try {
      const v = await p;
      setState("saved");
      return v;
    } catch (e) {
      setState("error");
      setMessage(e instanceof Error ? e.message : "That did not save.");
      return undefined;
    }
  }, []);
  return { state, message, track };
}
