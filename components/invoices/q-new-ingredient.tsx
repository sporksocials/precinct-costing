"use client";

import { useMemo } from "react";
import { useStore } from "@/lib/store";
import { invoiceSourceLabel } from "@/lib/invoice-apply";
import { newIngredientFields, supplierLabel, type QuestionBundle } from "@/lib/invoice-questions-view";
import { blankIngredient, IngredientSheet } from "@/components/ingredient-sheet";

/**
 * "Add As New Ingredient": the app's own New Ingredient sheet, filled in from the invoice line (a tidy name, the supplier and
 * its code, the pack size and price read from the line). It creates nothing until the person presses Add in the sheet. The
 * caller mounts it only while it is open, so every line starts from its own fresh copy of the form.
 */
export function NewIngredientFromLine({ bundle, onClose, onSaved }: { bundle: QuestionBundle; onClose: () => void; onSaved: (ing: { id: string; name: string }) => void }) {
  const store = useStore();
  const initial = useMemo(() => {
    if (!bundle.line) return blankIngredient();
    const supplier = supplierLabel(bundle);
    // the invoice supplier's linked costing supplier, else a costing supplier with the same name
    const costSupplierId = bundle.costSupplierId ?? store.suppliers.find((s) => s.name.trim().toLowerCase() === supplier.trim().toLowerCase())?.id ?? null;
    const f = newIngredientFields({
      line: bundle.line,
      costSupplierId,
      sourceLabel: invoiceSourceLabel({ invoice_number: bundle.doc?.invoice_number ?? null, invoice_date: bundle.doc?.invoice_date ?? null }, supplier),
    });
    return blankIngredient({ ...f, venues: "All" });
    // the form starts once per open: later store changes must not rewrite what the person is typing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle.q.id]);
  return (
    <IngredientSheet
      open
      initial={initial}
      title="Add As New Ingredient"
      note="Filled in from the invoice line. Check the name, pack size and price, then press Add. The line is matched to it when you press Save Matches."
      onClose={onClose}
      onSaved={(ing) => onSaved({ id: ing.id, name: ing.name })}
    />
  );
}
