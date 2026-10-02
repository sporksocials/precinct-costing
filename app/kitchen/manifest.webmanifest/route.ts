/** Web app manifest for the kitchen station: a Home Screen icon opens the kitchen select, not the costing app. */
export function GET() {
  return Response.json(
    {
      name: "Kitchen Station",
      short_name: "Kitchen",
      description: "Dish and prep recipes for the kitchen, Caloundra Food Precinct",
      start_url: "/kitchen",
      scope: "/kitchen",
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
