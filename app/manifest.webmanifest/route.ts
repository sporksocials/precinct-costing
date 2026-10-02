/**
 * The costing app's web app manifest. A route (not app/manifest.ts) so the root layout declares it through
 * `metadata.manifest`, which lets the bar display (/bar) swap in its own manifest: a file-based manifest
 * would be linked on every page and win.
 */
export function GET() {
  return Response.json(
    {
      name: "Caloundra Food Precinct · Costing",
      short_name: "Costing",
      description: "Recipe costing for the Caloundra Food Precinct",
      start_url: "/",
      display: "standalone",
      background_color: "#0E0E10",
      theme_color: "#0E0E10",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json" } },
  );
}
