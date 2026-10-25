"use client";

import { Suspense } from "react";
import { CheckScreen } from "@/components/invoices/check-screen";

export default function CheckThesePage() {
  return (
    <Suspense fallback={null}>
      <CheckScreen />
    </Suspense>
  );
}
