import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // API routes spawn the pipeline and read local files — keep everything on the Node runtime.
  reactStrictMode: true,
  // On Vercel this app is one service of the sparx project, mounted under /studio
  // (see vercel.json at the repo root); the family app owns the domain root.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
  env: { NEXT_PUBLIC_BASE_PATH: process.env.NEXT_PUBLIC_BASE_PATH || '' },
  // This app sits in a monorepo with a sibling lockfile; pin the tracing root to web/.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
};

export default nextConfig;
