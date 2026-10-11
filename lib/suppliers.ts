import { tidyName } from "./name-tidy";

/** A supplier name as typed into "Add New Supplier": spaces tidied and capitals fixed the way every other name in the app is. */
export function cleanSupplierName(raw: string): string {
  return tidyName(raw);
}

/** Lower case with spaces, punctuation and a trailing "pty ltd" removed, so "Bidfood", "BIDFOOD" and "Bid Food Pty Ltd" read as one supplier. */
export function supplierKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(pty|ltd|limited|p\/l)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

/** The supplier already in the list that a typed name means, or undefined. */
export function findSupplier<T extends { name: string }>(suppliers: readonly T[], typed: string): T | undefined {
  const key = supplierKey(typed);
  if (!key) return undefined;
  return suppliers.find((s) => supplierKey(s.name) === key);
}
