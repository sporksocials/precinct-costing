"use client";

import Link from "next/link";
import React, { useState } from "react";
import { ChevronDown, Printer, TriangleAlert } from "lucide-react";
import { matrixPrintHref } from "@/lib/allergy-matrix-print";
import { ALL_SECTIONS, type PrintStatus } from "@/lib/matrix-prints";
import { cx } from "../ui";

/** "All Sections" for the * key, otherwise the section's own name. */
export const sheetName = (key: string): string => (key === ALL_SECTIONS ? "All Sections" : key);

/**
 * Where one printed sheet stands: "Not printed yet" (never an alert), "Last printed 10 Oct 2026, version 3", or the same line plus
 * "Changed since printed: 2 added, 1 removed, 3 changed" with the dish names one tap away (the Print Again link goes to the preview).
 */
export function PrintStatusBlock({ status, venueSlug, sheetKey, className }: { status: PrintStatus; venueSlug: string; sheetKey: string; className?: string }) {
  const [open, setOpen] = useState(false);
  if (status.state === "never") return <p className={cx("text-[13px] text-label-2", className)}>Not printed yet</p>;
  return (
    <div className={className}>
      <p className="text-[13px] text-label-2">{status.line}</p>
      {status.state === "changed" ? (
        <div className="mt-1">
          <p className="flex items-start gap-1.5 text-[13px] font-semibold text-warn">
            <TriangleAlert aria-hidden className="mt-[2px] h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
            <span>{status.summary}</span>
          </p>
          <div className="flex flex-wrap items-center gap-x-3">
            <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="inline-flex min-h-[44px] items-center gap-1 text-[15px] font-medium text-accent sm:text-[13px]">
              {open ? "Hide Dishes" : "Show Dishes"}
              <ChevronDown aria-hidden className={cx("h-4 w-4 transition-transform", open && "rotate-180")} strokeWidth={2.5} />
            </button>
            <Link href={matrixPrintHref(venueSlug, sheetKey === ALL_SECTIONS ? null : sheetKey)} className="inline-flex min-h-[44px] items-center gap-1 text-[15px] font-medium text-accent sm:text-[13px]">
              <Printer aria-hidden className="h-4 w-4" strokeWidth={2.25} /> Print Again
            </Link>
          </div>
          {open ? (
            <div className="space-y-2 pb-1 text-[13px] leading-snug">
              <NameList title="Added" names={status.added} />
              <NameList title="Removed" names={status.removed} />
              <NameList title="Changed" names={status.changed} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function NameList({ title, names }: { title: string; names: string[] }) {
  if (!names.length) return null;
  return (
    <div>
      <p className="font-semibold text-label">
        {title} ({names.length})
      </p>
      <ul className="text-label-2">
        {names.map((n, i) => (
          <li key={`${n}-${i}`}>{n}</li>
        ))}
      </ul>
    </div>
  );
}
