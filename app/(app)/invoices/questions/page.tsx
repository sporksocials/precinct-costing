"use client";

import { Suspense } from "react";
import { QuestionsScreen } from "@/components/invoices/q-screen";

export default function InvoiceQuestionsPage() {
  return (
    <Suspense fallback={null}>
      <QuestionsScreen />
    </Suspense>
  );
}
