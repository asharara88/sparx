# Security updates

The record of dependency security upgrades in this repository, newest first. Keep it
short: the date, what was vulnerable, what it became, and how it was checked.

## How this stays automatic

- **Weekly audit** (`.github/workflows/security-audit.yml`): every Monday, and on
  demand from the Actions tab, `npm audit --audit-level=high` runs in the three package
  trees (the root app, `family/`, `web/`). If anything is found the workflow opens (or
  refreshes) the issue *Security audit: vulnerable dependencies* with the report, and
  closes it once the audit is clean. The fix is a pull request made by hand: `npm audit
  fix` in the app named, or the upgrade the advisory names; merge when CI is green and
  add a line below.
- **No Dependabot.** It was added on 2026-10-23 and removed the same day: for a
  one-maintainer app its weekly pull requests (each with a preview build and a CI run)
  cost more attention than they save, and the audit above already catches what matters.
  If advisory-only pull requests are ever wanted, that is the repository setting
  *Settings → Advanced Security → Dependabot security updates*, which needs no config
  file and opens nothing routine.
- A Next.js build also stops once with an upgrade notice when the installed version
  has a known advisory; it is a reminder, not a failure, and the same upgrade lands
  through the steps above.

## Log

### 2026-11-17

- **family and web: next 16.4.2 → 16.4.6** (moderate: a `'use cache'` function called
  through `unstable_cache()` could leak data across root params, GHSA-mfr8-8qww-v76h).
  The build's upgrade notice is gone.
- **family: zod 4.6.5 → 4.6.7 and @vercel/connect 2.4 → 2.9.3** (high: zod could exhaust
  memory validating oversized constrained collections, GHSA-mrhx-c7xc-m3w5; the old
  @vercel/connect pulled in a vulnerable zod through @vercel/oidc). `npm audit` is clean in
  both trees. Typecheck, the 231 unit tests, the database checks and both production
  builds pass.
- **Still open: root zod 3.25.** The same zod advisory covers every zod 3; the fix is
  zod 4, a major upgrade across the studio pipeline's schemas. Left for its own change.

### 2026-10-23

- **family: next 16.4.0 → 16.4.2** (critical: unauthenticated remote code execution
  in the image optimisation API with SVG files; denial of service in the App Router
  with Server Actions). Typecheck, the 118 unit tests, the database checks and the
  production build pass; the build's upgrade notice is gone.
- **root: vitest 2.1 → 5.0.5 with vite 7.3** (critical: prototype-pollution to remote
  code execution in tinypool; arbitrary file read through the vitest UI server and
  the mocker; path traversal and the dev-server request issue in vite and esbuild).
  vitest 5 needs node 22, so the root CI job moved from node 20 to 22. Typecheck and
  all 189 tests pass.
- **web: next 15.1 → 16.4.2** (critical: denial of service and server-side request
  forgery in Server Actions; the postcss advisories below ride inside Next 15 and only
  Next 16 carries the fixed one). `next lint` is gone in 16, so the dashboard's script
  is `typecheck` now, and CI gained a `web` job (typecheck and build). nanoid, sharp,
  source-map-js patched by `npm audit fix` on the way.
- **root: nanoid, postcss, source-map-js** patched by `npm audit fix` (high: infinite
  loops in nanoid, arbitrary `.map` file reads in postcss, event-loop denial of service
  in source-map-js).
- The weekly audit workflow and this file added (Dependabot too, then removed: see above).
