"use client";

import { useParams } from "next/navigation";
import { CountScreen } from "@/components/ordering/count/count-screen";

/** Ordering > Count for one venue. [venue] is the venue slug (drift, chiobu, greedy, gelato). */
export default function CountPage() {
  const params = useParams<{ venue: string }>();
  return <CountScreen slug={String(params.venue ?? "").toLowerCase()} />;
}
