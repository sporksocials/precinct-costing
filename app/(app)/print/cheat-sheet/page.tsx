"use client";

import { useSearchParams } from "next/navigation";
import { CheatSheetView } from "@/components/print/cheat-sheet-view";

/** Print preview for one venue's Kitchen Cheat Sheet: /print/cheat-sheet?venue=<slug> (see lib/cheat-sheet.ts). */
export default function CheatSheetPage() {
  const params = useSearchParams();
  return <CheatSheetView slug={params.get("venue")} />;
}
