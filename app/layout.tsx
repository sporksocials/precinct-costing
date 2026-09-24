import type { Metadata, Viewport } from "next";
import "./globals.css";
import { fontVars } from "./fonts";

export const metadata: Metadata = {
  title: "Precinct Costing",
  description: "Caloundra Food Precinct recipe costing and menu pricing for Drift Bar, Chiobu, Greedy Gringo's and Gelato Rumba",
  applicationName: "Precinct Costing",
  appleWebApp: { capable: true, title: "Costing", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
  other: { "mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0e0e10",
  colorScheme: "dark",
};

// Applies the venue accent from the URL before first paint (no colour flash), only on the pages that carry the venue filter.
// Everything else stays on the neutral sand accent (data-venue="all").
const venueBoot = `try{var p=location.pathname.replace(/\\/+$/,"")||"/";if(p==="/"||p==="/recipes"||p==="/beers"){var s=new URLSearchParams(location.search).get("venue");if(s&&/^[a-z]+$/.test(s))document.documentElement.setAttribute("data-venue",s)}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU" data-venue="all" className={`dark ${fontVars}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: venueBoot }} />
      </head>
      <body className="min-h-[100dvh] font-sans text-[17px] leading-snug sm:text-[15px]">{children}</body>
    </html>
  );
}
