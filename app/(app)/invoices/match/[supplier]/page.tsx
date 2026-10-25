"use client";

import { MatchScreen } from "@/components/invoices/match-screen";

export default function MatchSupplierPage({ params }: { params: { supplier: string } }) {
  return <MatchScreen scope={{ kind: "supplier", param: decodeURIComponent(params.supplier) }} />;
}
