"use client";
import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

let client: ReturnType<typeof createBrowserClient> | null = null;

/** The "view as" token, when an admin is previewing another member (cookie set by the server). */
function previewToken(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)view_as=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Supabase client for Client Components (one per tab). In a preview it carries the preview token instead of the session. */
export function supabaseBrowser() {
  if (!client) {
    const token = previewToken();
    client = token
      ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } })
      : createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return client;
}
