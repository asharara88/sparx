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
