/**
 * The "Additional Apps" list (Troy, 13 Oct 2026): the other apps SPORK built for the precinct, reached from the bottom of the
 * desktop sidebar and from the phone More page. One list so both always agree; a new app is one more entry here (and its icon
 * in `components/other-apps.tsx`). These are separate full screen apps with their own start screens (the venue choosers), so
 * they open in a new tab and never replace the costing app. Pure data, no React.
 */
export interface OtherApp {
  id: string;
  label: string;
  /** one line for the phone More page */
  sub: string;
  /** the app's own start screen (a public page, no costing sign-in needed) */
  href: string;
}

export const OTHER_APPS_TITLE = "Additional Apps";

export const OTHER_APPS: readonly OtherApp[] = [
  { id: "kitchen", label: "Kitchen App", sub: "Recipes and the Allergy Matrix", href: "/kitchen" },
  { id: "drinks", label: "Drinks Station App", sub: "Drink recipes for the bar", href: "/bar" },
];
