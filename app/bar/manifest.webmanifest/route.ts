/** Web app manifest for the drinks station: a Home Screen icon opens the venue select, not the costing app. */
export function GET() {
  return Response.json(
    {
      name: "Drinks Station",
      short_name: "Drinks",
      description: "Drink recipes for the bar, Caloundra Food Precinct",
      start_url: "/bar",
      scope: "/bar",
      display: "standalone",
      orientation: "portrait",
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
