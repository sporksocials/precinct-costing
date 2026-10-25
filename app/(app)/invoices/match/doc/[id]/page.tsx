"use client";

import { MatchScreen } from "@/components/invoices/match-screen";

export default function MatchInvoicePage({ params }: { params: { id: string } }) {
  return <MatchScreen scope={{ kind: "doc", id: decodeURIComponent(params.id) }} />;
}
