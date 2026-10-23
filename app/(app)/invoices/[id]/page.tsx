"use client";

import { useParams } from "next/navigation";
import { InvoiceDetail } from "@/components/invoices/inv-detail";

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  return <InvoiceDetail id={id} />;
}
