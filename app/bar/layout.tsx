import type { Metadata } from "next";

/**
 * Bar display: the public cocktail station iPads. Outside the (app) group and listed as public in
 * middleware.ts, so it never asks for a login. Its own manifest makes "Add to Home Screen" open /bar,
 * not the costing app's sign-in.
 */
export const metadata: Metadata = {
  title: "Cocktail Station",
  description: "Cocktail recipes for the bar, Caloundra Food Precinct",
  manifest: "/bar/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Cocktails", statusBarStyle: "black-translucent" },
  robots: { index: false, follow: false },
};

export default function BarLayout({ children }: { children: React.ReactNode }) {
  return children;
}
