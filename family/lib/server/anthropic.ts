/**
 * The Anthropic key can be stored under either name on the server. Vercel projects in this
 * household use ANTHROPIC_API_SECRET_KEY; ANTHROPIC_API_KEY (the SDK default) still works.
 */
export function anthropicApiKey(): string | undefined {
  return process.env.ANTHROPIC_API_SECRET_KEY || process.env.ANTHROPIC_API_KEY || undefined;
}
