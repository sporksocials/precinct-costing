/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // always inline the demo flag so demo-only code is dead-code-eliminated from production bundles
  env: { NEXT_PUBLIC_DEMO: process.env.NEXT_PUBLIC_DEMO === "1" ? "1" : "" },
  experimental: {
    // the demo fixture is local-only client data: never trace it into a deployment bundle
    outputFileTracingExcludes: { "*": [".demo/**"] },
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
