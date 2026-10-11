/**
 * Renaming an ingredient, dish, prep or tap beer (Troy, 11 Oct 2026: "make it simple to change an ingredient name or menu item name").
 * The database refuses a second record with the same name (an ingredient name is unique, a dish or prep name is unique within its
 * venue, a tap beer within its venue), which used to surface as a raw error after pressing Save. This is the check made BEFORE, in
 * plain words. Names are compared ignoring capitals and extra spaces ("Chicken  Thigh" and "chicken thigh" are the same name to a person).
 */
export const nameKey = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();

export interface Named {
  id: string;
  name: string;
}

/** The other record that already has this name, or null. `selfId` is the record being renamed (it never clashes with itself). */
export function findClash<T extends Named>(name: string, others: readonly T[], selfId: string): T | null {
  const k = nameKey(name);
  if (!k) return null;
  return others.find((o) => o.id !== selfId && nameKey(o.name) === k) ?? null;
}

/** "Another ingredient is already called Chicken Thigh." / "Another dish at Drift is already called Burger." */
export function clashMessage(thing: string, clash: Named, where?: string | null): string {
  return `Another ${thing}${where ? ` at ${where}` : ""} is already called ${clash.name}. Pick a different name.`;
}
