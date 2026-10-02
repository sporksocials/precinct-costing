import type { Metadata } from "next";
import { KitchenKiosk } from "@/components/kitchen/kiosk";

/**
 * Kitchen station: the public iPad recipe screens for each kitchen. Outside the (app) group and listed as public in
 * middleware.ts, so it never asks for a login. Its own manifest makes "Add to Home Screen" open /kitchen,
 * not the costing app's sign-in.
 */
export const metadata: Metadata = {
  title: "Kitchen Station",
  description: "Dish and prep recipes for the kitchen, Caloundra Food Precinct",
  manifest: "/kitchen/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Kitchen", statusBarStyle: "black-translucent" },
  robots: { index: false, follow: false },
};

export default function KitchenLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <KitchenKiosk />
      {children}
    </>
  );
}
