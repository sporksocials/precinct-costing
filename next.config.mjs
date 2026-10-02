/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // always inline the demo flag so demo-only code is dead-code-eliminated from production bundles
  env: { NEXT_PUBLIC_DEMO: process.env.NEXT_PUBLIC_DEMO === "1" ? "1" : "" },
  experimental: {
    // the demo fixture is local-only client data: never trace it into a deployment bundle
    outputFileTracingExcludes: { "*": [".demo/**"] },
  },
  async rewrites() {
    // Station photos uploaded from the recipe editor (cocktails at /bar, plated dishes at /kitchen) sit in the public `bar-photos` storage bucket.
    // Serving them from our own /bar/photo/ and /kitchen/photo/ paths (not the storage URL) keeps them same-origin, so each iPad's offline
    // copy (app/bar/sw.js, app/kitchen/sw.js) can hold them.
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!base) return [];
    const photos = `${base}/storage/v1/object/public/bar-photos/:path*`;
    return [
      { source: "/bar/photo/:path*", destination: photos },
      { source: "/kitchen/photo/:path*", destination: photos },
    ];
  },
  async redirects() {
    return [
      // Recipes became Menu (dishes and drinks) and Ingredients > Preps; tap beer and gelato live inside Menu
      { source: "/recipes", has: [{ type: "query", key: "type", value: "preps" }], destination: "/ingredients?type=preps", permanent: false },
      { source: "/recipes", destination: "/menu", permanent: false },
      { source: "/beers", destination: "/menu?cat=Tap%20Beer", permanent: false },
      { source: "/items", destination: "/menu", permanent: false },
      { source: "/preps", destination: "/ingredients?type=preps", permanent: false },
    ];
  },
};

export default nextConfig;
