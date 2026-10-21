import { SignJWT } from "jose";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

/**
 * Server-side clients for the scheduled jobs. Two kinds:
 *  - the service client: reads the subscription and notification tables, nothing else;
 *  - a member client: a short-lived JWT signed with the project's JWT secret for that
 *    member's auth user, so everything the job computes for them runs under their own
 *    Row Level Security, exactly as if they had opened the app. It also names the
 *    member row: an account can be in several homes (docs/MULTI_HOME.md), and a job
 *    for the row in one home must not run as the account's chosen home. The
 *    database honours the claim only for a row of that very account.
 * Both need secrets that never reach the browser.
 */

export function cronConfigured(): { ok: boolean; missing: string[] } {
  const missing = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_JWT_SECRET", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "CRON_SECRET"].filter((k) => !process.env[k]);
  return { ok: missing.length === 0, missing };
}

export function serviceClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function memberClient(userId: string, memberId?: string): Promise<SupabaseClient> {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) throw new Error("SUPABASE_JWT_SECRET is not set");
  const jwt = await new SignJWT({ role: "authenticated", aud: "authenticated", ...(memberId ? { member_id: memberId } : {}) })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuer(`${SUPABASE_URL}/auth/v1`)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(secret));
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Constant-time compare for the cron secret. */
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || got.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= secret.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}
