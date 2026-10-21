import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  headers: async () => [
    { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
  ],
  // The child's section used to live under the first household's name.
  // Installed home-screen icons and old pushes still point there.
  redirects: async () => [
    { source: "/lana", destination: "/baby", permanent: false },
    { source: "/lana/:path*", destination: "/baby/:path*", permanent: false },
  ],
};

export default nextConfig;
