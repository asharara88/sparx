// Automated browser control for the pipeline (Build-Spec: "act on Chrome" = Playwright path).
// Used by Research (trends/scraping) and Publishing (YouTube upload) in later phases.
// Lazily imports playwright so the core skeleton runs even before deps are installed.
import type { Browser, BrowserContext, Page } from 'playwright';

export interface BrowserSession { browser: Browser; context: BrowserContext; page: Page; close(): Promise<void>; }

export async function launchBrowser(): Promise<BrowserSession> {
  const { chromium } = await import('playwright');
  const headless = (process.env.PLAYWRIGHT_MODE ?? 'headless') !== 'headed';
  const cdp = process.env.CHROME_CDP_ENDPOINT;

  const browser = cdp
    ? await chromium.connectOverCDP(cdp)            // attach to a running Chrome
    : await chromium.launch({ headless });           // launch a managed Chromium

  const context = await browser.newContext();
  const page = await context.newPage();
  return { browser, context, page, async close() { await context.close(); await browser.close(); } };
}

// Convenience used by browser-test + Research stub.
export async function fetchTitle(url: string): Promise<string> {
  const s = await launchBrowser();
  try { await s.page.goto(url, { waitUntil: 'domcontentloaded' }); return await s.page.title(); }
  finally { await s.close(); }
}
