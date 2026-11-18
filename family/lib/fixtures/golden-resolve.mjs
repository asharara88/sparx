/**
 * How the golden test finds the helper's own files (lib/golden-baby.test.ts).
 *
 * The unit tests run under plain node, which knows neither the app's "@/" alias nor an
 * import written without ".ts". lib/assistant/prompt.ts, situation.ts and tools.ts use both.
 * This hook resolves the two forms for files of the app, so those files are loaded and
 * called exactly as they are: nothing in them is changed, and nothing is copied out of them.
 *
 * Registered by lib/fixtures/golden-calls.ts, in the golden test's own process only. A
 * package's imports and node's own are left alone.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The app's folder (family/), two levels up from this file. */
const ROOT = new URL("../../", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  const from = context.parentURL ?? "";
  if (!from.startsWith(ROOT) || from.includes("/node_modules/")) return nextResolve(specifier, context);
  let target = null;
  if (specifier.startsWith("@/")) target = new URL(specifier.slice(2), ROOT).href;
  else if (specifier.startsWith("./") || specifier.startsWith("../")) target = new URL(specifier, from).href;
  if (target === null) return nextResolve(specifier, context);
  if (!/\.[a-z]+$/i.test(target) && existsSync(fileURLToPath(`${target}.ts`))) target = `${target}.ts`;
  return nextResolve(target, context);
}
