import { SignJWT, jwtVerify } from "jose";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

/**
 * "View as": an admin sees the app as another member. The server mints a JWT with the
 * project's secret carrying preview_member and preview_by; the database then treats the
 * caller as that member and refuses every action but 'view'. The token lives in a cookie
 * the browser client also reads, so client components see the same view.
 */
export const PREVIEW_COOKIE = "view_as";
export const PREVIEW_TTL_SECONDS = 60 * 60;

export function previewConfigured(): boolean {
  return !!process.env.SUPABASE_JWT_SECRET;
}

function secret(): Uint8Array {
  const s = process.env.SUPABASE_JWT_SECRET;
  if (!s) throw new Error("SUPABASE_JWT_SECRET is not set");
  return new TextEncoder().encode(s);
}

export async function mintPreviewToken(memberId: string, adminUserId: string): Promise<string> {
  return new SignJWT({ role: "authenticated", aud: "authenticated", preview_member: memberId, preview_by: adminUserId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(adminUserId)
    .setIssuer(`${SUPABASE_URL}/auth/v1`)
    .setIssuedAt()
    .setExpirationTime(`${PREVIEW_TTL_SECONDS}s`)
    .sign(secret());
}

export interface PreviewClaims {
  memberId: string;
  adminUserId: string;
}

/** The claims of a valid, unexpired preview token, or null. */
export async function verifyPreviewToken(token: string | undefined): Promise<PreviewClaims | null> {
  if (!token || !previewConfigured()) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    const memberId = payload.preview_member;
    const adminUserId = payload.preview_by;
    if (typeof memberId !== "string" || typeof adminUserId !== "string" || payload.sub !== adminUserId) return null;
    return { memberId, adminUserId };
  } catch {
    return null;
  }
}

export function previewClient(token: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
