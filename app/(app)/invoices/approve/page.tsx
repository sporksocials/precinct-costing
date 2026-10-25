"use client";

import { Suspense } from "react";
import { ApproveScreen } from "@/components/invoices/approve-screen";

export default function ApprovePricesPage() {
  return (
    <Suspense fallback={null}>
      <ApproveScreen />
    </Suspense>
  );
}
