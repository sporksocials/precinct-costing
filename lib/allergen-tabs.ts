/**
 * The three views of Allergens, in one place so the sidebar, the phone More page and the tab strip can never disagree
 * (components/matrix/allergen-tabs.tsx). `Matrix` is the home: the sidebar and More page link to it.
 */
export type AllergenTab = "matrix" | "todo" | "labels";

export const ALLERGEN_TABS: readonly { id: AllergenTab; label: string; path: string }[] = [
  { id: "matrix", label: "Matrix", path: "/matrix" },
  { id: "todo", label: "To Do", path: "/matrix/todo" },
  { id: "labels", label: "Menu Labels", path: "/allergens" },
];

/** The address of a tab with the venue carried across (Menu Labels has no venue choice of its own, so it takes none). */
export function allergenTabHref(tab: AllergenTab, venueSlug?: string | null): string {
  const t = ALLERGEN_TABS.find((x) => x.id === tab)!;
  return venueSlug && tab !== "labels" ? `${t.path}?venue=${venueSlug}` : t.path;
}

/** Whether a page belongs to Allergens (for the sidebar highlight). The ingredient review is about ingredients, so it stays under Ingredients. */
export function inAllergens(pathname: string): boolean {
  if (pathname === "/allergens") return true;
  return pathname === "/matrix" || pathname.startsWith("/matrix/");
}
