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
      { source: "/items", destination: "/recipes", permanent: false },
      { source: "/preps", destination: "/recipes?type=preps", permanent: false },
    ];
  },
};

export default nextConfig;
