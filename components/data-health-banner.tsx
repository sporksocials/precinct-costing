"use client";

import React, { useEffect, useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { useStore } from "@/lib/store";
import { tableLabel, type TableMismatch } from "@/lib/health";
import { Banner, useToast } from "./ui";

function detail(m: TableMismatch): string {
  if (m.reason === "error") return `${tableLabel(m.table)} (couldn’t load)`;
  if (m.reason === "duplicate") return `${tableLabel(m.table)} (repeated rows)`;
  return `${tableLabel(m.table)} (${m.loaded.toLocaleString("en-AU")} of ${m.expected.toLocaleString("en-AU")})`;
}

/**
 * The app's promise is that it never shows costs built from a partial load. This is where a broken promise is shown:
 * nothing while data is ok or was quietly repaired, a slim bar if a check runs long, a loud red banner if some
 * data is still missing after healing, and a full explanation if this sign in can see nothing.
 * It also says, once, when another person's change was merged in.
 */
export function DataHealthBanner() {
  const { health, ready, refreshing, recheck, accessDenied, externalUpdates, signOut } = useStore();
  const toast = useToast();

  // "Updated with the latest changes": only for changes made by someone else (the store counts those)
  const seen = useRef(externalUpdates);
  useEffect(() => {
    if (externalUpdates === seen.current) return;
    seen.current = externalUpdates;
    toast.show({ message: "Updated with the latest changes" }, 3500);
  }, [externalUpdates, toast]);

  // healing is invisible unless it drags on
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (health.state !== "healing") {
      setSlow(false);
      return;
    }
    const t = window.setTimeout(() => setSlow(true), 2000);
    return () => window.clearTimeout(t);
  }, [health.state]);

  if (!ready) return null;

  if (health.state === "healing") {
    return slow ? (
      <div role="status" className="mt-3">
        <Banner tone="neutral">Checking your data...</Banner>
      </div>
    ) : null;
  }

  if (health.state === "blocked") {
    if (accessDenied) return null; // the "No access" screen already says it
    return (
      <div role="alert" className="mt-3 rounded-2xl px-4 py-4 text-[15px]" style={{ background: "var(--danger)", color: "#1a0806" }}>
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={2.25} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[17px] font-semibold">You do not have access to this data</p>
            <p className="mt-1">Your sign in may have ended, or your email may not be on the access list. Sign out and sign in again, or ask SPORK to check your access. No costs are shown until this is sorted.</p>
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <button type="button" className="btn min-h-[44px] flex-1 sm:flex-none" style={{ background: "rgba(0,0,0,0.85)", color: "#fff" }} onClick={() => void recheck()} disabled={refreshing}>
            {refreshing ? "Checking..." : "Try Again"}
          </button>
          <button type="button" className="btn min-h-[44px] flex-1 sm:flex-none" style={{ background: "rgba(0,0,0,0.12)", color: "#1a0806" }} onClick={() => void signOut()}>
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  if (health.state === "degraded") {
    const names = health.mismatches.map(detail);
    return (
      <div role="alert" className="mt-3 rounded-2xl px-4 py-3 text-[15px] sm:flex sm:items-center sm:gap-4" style={{ background: "var(--danger)", color: "#1a0806" }}>
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={2.25} aria-hidden />
          <div className="min-w-0">
            <p className="font-semibold">{health.message}</p>
            {names.length ? <p className="mt-0.5 text-[13px]">Affected: {names.join(", ")}</p> : null}
          </div>
        </div>
        <button
          type="button"
          className="btn mt-3 min-h-[44px] w-full shrink-0 sm:mt-0 sm:w-auto"
          style={{ background: "rgba(0,0,0,0.85)", color: "#fff" }}
          onClick={() => void recheck()}
          disabled={refreshing}
        >
          {refreshing ? "Checking..." : "Retry"}
        </button>
      </div>
    );
  }

  return null; // ok and repaired: nothing to say
}
