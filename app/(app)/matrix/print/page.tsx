"use client";

import { useSearchParams } from "next/navigation";
import { MatrixPrintView } from "@/components/matrix/print-view";

/** Allergy Matrix print preview: /matrix/print?venue=drift&section=Mains, or section=* for every section (see lib/allergy-matrix-print.ts). */
export default function MatrixPrintPage() {
  const params = useSearchParams();
  return <MatrixPrintView venueSlug={params.get("venue") ?? ""} section={params.get("section")} />;
}
