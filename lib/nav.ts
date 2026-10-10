import { inAllergens } from "./allergen-tabs";

/**
 * Which navigation entry a page belongs to, in one pure place so the desktop sidebar, the phone tab bar and the tests can never
 * disagree (components/app-shell.tsx). No React, no store.
 */

/** Sidebar and More-page hrefs that are not one of the phone tabs. */
export const MORE_HREFS = ["/research-notes", "/portal-prices", "/data-health", "/change-log", "/trash", "/settings"] as const;

/** Whether a page belongs to the sidebar entry `href`. */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname === "/alerts"; // the full alert list is part of Home
  // Allergens is one entry: the matrix, its To Do, review mode, print, and Menu Labels (lib/allergen-tabs.ts)
  if (href === "/matrix") return inAllergens(pathname);
  // record pages belong to the list they open from: dishes, beers and gelato to Menu; preps to Ingredients
  if (href === "/menu") return ["/menu", "/beers", "/items", "/gelato"].some((b) => pathname === b || pathname.startsWith(b + "/"));
  // ingredient allergen review is about ingredients, so it lives under Ingredients (Menu Labels shares the /allergens prefix)
  if (href === "/ingredients") return pathname.startsWith("/ingredients") || pathname.startsWith("/preps") || pathname.startsWith("/allergens/review");
  return pathname === href || pathname.startsWith(href + "/");
}

/** The phone tab bar: Home, Menu, Ingredients, Ordering (daily stock counts), More. Search lives on the More page (⌘K on desktop). */
export const PHONE_TABS = [
  { id: "home", href: "/", label: "Home" },
  { id: "menu", href: "/menu", label: "Menu" },
  { id: "ingredients", href: "/ingredients", label: "Ingredients" },
  { id: "ordering", href: "/ordering", label: "Ordering" },
  { id: "more", href: "/more", label: "More" },
] as const;
export type PhoneTabId = (typeof PHONE_TABS)[number]["id"];

/**
 * The one phone tab to highlight for a page, or null when the page belongs to none (a full screen layer such as /print).
 * Everything that is not Home, Menu, Ingredients or Ordering sits behind More: the More page itself, Search, Specials, Allergens
 * and the More list (Research Notes, Supplier Prices, Data Health, Change Log, Trash, Settings).
 */
export function phoneTab(pathname: string): PhoneTabId | null {
  if (pathname === "/ordering" || pathname.startsWith("/ordering/")) return "ordering";
  if (isActive(pathname, "/")) return "home";
  if (isActive(pathname, "/menu")) return "menu";
  if (isActive(pathname, "/ingredients")) return "ingredients"; // before Allergens: /allergens/review is an ingredient screen
  if (pathname === "/more" || pathname === "/search" || pathname === "/specials" || pathname.startsWith("/specials/")) return "more";
  if (inAllergens(pathname) || pathname.startsWith("/allergens")) return "more";
  if (MORE_HREFS.some((h) => pathname === h || pathname.startsWith(h + "/"))) return "more";
  return null;
}

export function hidesTabBar(pathname: string): boolean {
  // record pages hold their own save bar, and the two review modes (dishes, ingredients) hold their own Confirm bar: none shares the bottom with the tab bar
  return /^\/(items|preps)\/[^/]+$/.test(pathname) || pathname === "/matrix/review" || pathname === "/allergens/review";
}
