import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Precinct Costing",
  description: "Recipe costing and menu pricing for Drift Bar, Chiobu, Greedy Gringo's and Gelato Rumba",
  applicationName: "Precinct Costing",
  appleWebApp: { capable: true, title: "Costing", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  other: { "mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F2F2F7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

// Applies the remembered venue accent before first paint (no colour flash).
const venueBoot = `try{var s=new URLSearchParams(location.search).get("venue")||localStorage.getItem("precinct-venue")||"all";document.documentElement.setAttribute("data-venue",s)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU" data-venue="all" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: venueBoot }} />
      </head>
      <body className="min-h-[100dvh] font-sans text-[17px] leading-snug sm:text-[15px]">{children}</body>
    </html>
  );
}
