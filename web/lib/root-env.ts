import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { REPO_ROOT } from './paths';

// Load the pipeline's repo-root .env so the dashboard shares one source of secrets.
// web/.env.local (already loaded by Next) wins on conflicts — we don't override it.
let loaded = false;
export function ensureEnv(): void {
  if (loaded) return;
  loadEnv({ path: resolve(REPO_ROOT, '.env'), override: false });
  loaded = true;
}
