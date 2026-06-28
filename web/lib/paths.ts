import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// web/lib/paths.ts -> repo root is two levels up. Resolved from the file location
// so it is correct regardless of the process working directory.
const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '..', '..');
export const GENERATED_DIR = resolve(REPO_ROOT, 'generated');
