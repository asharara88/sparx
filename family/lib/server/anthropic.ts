import type { ClientOptions } from "@anthropic-ai/sdk";

/**
 * The Anthropic key can be stored under either name on the server. Vercel projects in this
 * household use ANTHROPIC_API_SECRET_KEY; ANTHROPIC_API_KEY (the SDK default) still works.
 */
export function anthropicApiKey(): string | undefined {
  return process.env.ANTHROPIC_API_SECRET_KEY || process.env.ANTHROPIC_API_KEY || undefined;
}

/**
 * Workload Identity Federation: no key on the server at all. Vercel hands each function run a
 * short-lived OIDC token (VERCEL_OIDC_TOKEN, once "Secure backend access with OIDC federation"
 * is on for the project); the SDK exchanges it for Anthropic access when the three federation
 * ids are set. Set up once in the Claude Console: a federation issuer for Vercel's OIDC, a
 * service account in the workspace, and a rule that maps this project to it.
 */
export function federationConfigured(): boolean {
  return !!(process.env.ANTHROPIC_FEDERATION_RULE_ID && process.env.ANTHROPIC_ORGANIZATION_ID && process.env.ANTHROPIC_SERVICE_ACCOUNT_ID && (process.env.ANTHROPIC_IDENTITY_TOKEN || process.env.ANTHROPIC_IDENTITY_TOKEN_FILE || process.env.VERCEL_OIDC_TOKEN));
}

/** True when the model can be called at all: a key, or federation. */
export function modelConfigured(): boolean {
  return !!anthropicApiKey() || federationConfigured();
}

/**
 * Options for every Anthropic client in the app. A key that is not scoped to a workspace
 * must send the workspace id with each request (set ANTHROPIC_WORKSPACE_ID); a key made
 * inside a workspace needs nothing more.
 */
export function anthropicOptions(extra: ClientOptions = {}): ClientOptions {
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  const key = anthropicApiKey();
  if (!key && federationConfigured() && !process.env.ANTHROPIC_IDENTITY_TOKEN && !process.env.ANTHROPIC_IDENTITY_TOKEN_FILE && process.env.VERCEL_OIDC_TOKEN) {
    // Hand Vercel's token to the SDK under the name it reads. Per function run; it refreshes itself.
    process.env.ANTHROPIC_IDENTITY_TOKEN = process.env.VERCEL_OIDC_TOKEN;
  }
  return {
    // With no key the SDK resolves credentials itself (federation env vars).
    ...(key ? { apiKey: key } : {}),
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
