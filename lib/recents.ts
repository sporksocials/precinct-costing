"use client";

import { useSyncExternalStore } from "react";

export interface Recent {
  kind: "item" | "prep" | "ingredient" | "portal";
  id: string;
  title: string;
  sub: string;
  href: string;
}

const KEY = "precinct-recent-v1";
const MAX = 8;
const EVT = "precinct-recents";
let cache: Recent[] | null = null;

function read(): Recent[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(window.localStorage.getItem(KEY) || "[]") as Recent[];
  } catch {
    cache = [];
  }
  return cache;
}

export function addRecent(r: Recent) {
  const next = [r, ...read().filter((x) => !(x.kind === r.kind && x.id === r.id))].slice(0, MAX);
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVT));
}

const EMPTY: Recent[] = [];
export function useRecents(): Recent[] {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(EVT, cb);
      return () => window.removeEventListener(EVT, cb);
    },
    read,
    () => EMPTY,
  );
}
