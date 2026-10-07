"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { parsePrintParams } from "@/lib/print-job";
import { PrintView } from "@/components/print/print-view";

/** Print preview for one or more recipes: /print?kind=item|prep&ids=a,b,c (see lib/print-job.ts). */
export default function PrintPage() {
  const params = useSearchParams();
  const kindRaw = params.get("kind");
  const idsRaw = params.get("ids");
  const job = useMemo(() => parsePrintParams(kindRaw, idsRaw), [kindRaw, idsRaw]);
  return <PrintView kind={job.kind} ids={job.ids} capped={job.capped} />;
}
