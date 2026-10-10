"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cameFromChooser, markFromChooser } from "@/lib/station-names";

/**
 * A venue link on an iPad app's chooser ("Which kitchen are you working in?"). Tapping it remembers, for this browser session
 * only, that the person came through the chooser, so the venue screen may show the way back to it. An iPad opened straight on
 * its venue never taps one of these, so it never shows that link and cannot wander into another venue's screen.
 */
export function ChooserLink({ station, href, className, children }: { station: "kitchen" | "bar"; href: string; className?: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={className} onClick={() => markFromChooser(station)}>
      {children}
    </Link>
  );
}

/** True once the page has mounted and this session came through the chooser. False on the server and on the first render, so hydration matches. */
export function useFromChooser(station: "kitchen" | "bar"): boolean {
  const [from, setFrom] = useState(false);
  useEffect(() => setFrom(cameFromChooser(station)), [station]);
  return from;
}
