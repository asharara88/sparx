import type { ClientOptions } from "@anthropic-ai/sdk";

/**
 * The Anthropic key can be stored under either name on the server. Vercel projects in this
 * household use ANTHROPIC_API_SECRET_KEY; ANTHROPIC_API_KEY (the SDK default) still works.
 */
export function anthropicApiKey(): string | undefined {
  return process.env.ANTHROPIC_API_SECRET_KEY || process.env.ANTHROPIC_API_KEY || undefined;
}

/**
 * Options for every Anthropic client in the app. A key that is not scoped to a workspace
 * must send the workspace id with each request (set ANTHROPIC_WORKSPACE_ID); a key made
 * inside a workspace needs nothing more.
 */
export function anthropicOptions(extra: ClientOptions = {}): ClientOptions {
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  return {
    apiKey: anthropicApiKey(),
    maxRetries: 2,
    ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}),
    ...extra,
  };
}

/**
 * What to tell a member when the model call failed. Never the raw API JSON: the
 * grandmothers should read a sentence, and admins get the one-line cause.
 * `setup` is true when the fix is a server setting rather than a retry.
 */
export function friendlyModelError(e: unknown): { message: string; setup: boolean } {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  const status = typeof (e as { status?: unknown })?.status === "number" ? (e as { status: number }).status : /^\s*(\d{3})\b/.exec(raw)?.[1] ? Number(/^\s*(\d{3})\b/.exec(raw)![1]) : null;
  if (/anthropic-workspace-id|not scoped to a workspace/i.test(raw)) return { message: "The assistant key needs a workspace: set ANTHROPIC_WORKSPACE_ID on the server, or use a key made inside a workspace.", setup: true };
  if (status === 401 || /invalid x-api-key|authentication_error/i.test(raw)) return { message: "The assistant key is not valid. Check ANTHROPIC_API_SECRET_KEY on the server.", setup: true };
  if (status === 403 || /permission_error/i.test(raw)) return { message: "The assistant key is not allowed to use this model.", setup: true };
  if (status === 429 || /rate_limit/i.test(raw)) return { message: "The assistant is busy right now. Try again in a minute.", setup: false };
  if (status === 529 || /overloaded/i.test(raw)) return { message: "The assistant is overloaded right now. Try again in a minute.", setup: false };
  if (/billing|credit/i.test(raw)) return { message: "The assistant account has no credit left.", setup: true };
  if (/fetch failed|ECONN|ENOTFOUND|timeout|timed out/i.test(raw)) return { message: "The assistant could not be reached. Try again.", setup: false };
  return { message: "The assistant could not answer just now. Try again.", setup: false };
}
