import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // API routes spawn the pipeline and read local files — keep everything on the Node runtime.
  reactStrictMode: true,
  // This app sits in a monorepo with a sibling lockfile; pin the tracing root to web/.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
};

export default nextConfig;
