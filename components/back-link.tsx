"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { BackRules } from "@/lib/list-memory";
import { useBackHref } from "./use-back-href";

/** The back arrow on a record page: returns to its list exactly as it was left (see lib/list-memory.ts). */
export function BackLink({ path, fallback, rules, className, children }: { path: string; fallback: string; rules?: BackRules; className?: string; children: ReactNode }) {
  const href = useBackHref(path, fallback, rules);
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
