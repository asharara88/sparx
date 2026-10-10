import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  headers: async () => [
    { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
  ],
};

export default nextConfig;
