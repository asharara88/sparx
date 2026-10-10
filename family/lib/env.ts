export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "";

/** True when the app has been pointed at a Supabase project. */
export function isConfigured(): boolean {
  return SUPABASE_URL.startsWith("http") && SUPABASE_ANON_KEY.length > 20;
}
