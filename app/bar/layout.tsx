import type { Metadata } from "next";
import { BarKiosk } from "@/components/bar/kiosk";

/**
 * Bar display: the public drinks station iPads. Outside the (app) group and listed as public in
 * middleware.ts, so it never asks for a login. Its own manifest makes "Add to Home Screen" open /bar,
 * not the costing app's sign-in.
 */
export const metadata: Metadata = {
  title: "Drinks",
  description: "Drink recipes for the bar, Caloundra Food Precinct",
  manifest: "/bar/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Drinks", statusBarStyle: "black-translucent" },
  robots: { index: false, follow: false },
};

export default function BarLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BarKiosk />
      {children}
    </>
  );
}
