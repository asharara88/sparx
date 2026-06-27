// Smoke test for the Playwright path. Run: npm run browser:test
import 'dotenv/config';
import { fetchTitle } from '../src/browser/playwright.js';
const url = process.argv[2] || 'https://example.com';
fetchTitle(url)
  .then((t) => { console.log(`OK — title of ${url}: "${t}"`); process.exit(0); })
  .catch((e) => { console.error('Browser test failed:', e?.message ?? e); process.exit(1); });
