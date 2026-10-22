"use client";
import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";
import { HOME_COOKIE, HOME_COOKIE_MAX_AGE, homeId, withHome } from "@/lib/home-cookie";

let client: ReturnType<typeof createBrowserClient> | null = null;

/** The home this page shows, bound by the app layout; every request names it (lib/home-cookie.ts). */
let bound: string | null = null;

export function bindHome(id: string | null) {
  bound = homeId(id);
  if (!bound || typeof document === "undefined") return;
  const secure = location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${HOME_COOKIE}=${bound}; path=/; max-age=${HOME_COOKIE_MAX_AGE}; samesite=lax${secure}`;
}

/** The bound home goes on every request that does not already name one (a queued entry's replay names its own). */
const homeFetch: typeof fetch = (input, init) => fetch(input, withHome(init, bound));

/**
 * fetch for the app's own API routes: the page's bound home goes along, so a tab
 * bound to one home never has its request read as another tab's cookie.
 */
export const apiFetch: typeof fetch = (input, init) => fetch(input, withHome(init, bound));

/** The "view as" token, when an admin is previewing another member (cookie set by the server). */
function previewToken(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)view_as=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Supabase client for Client Components (one per tab). In a preview it carries the
 * preview token instead of the session. Every request names the bound home.
 */
export function supabaseBrowser() {
  if (!client) {
    const token = previewToken();
    client = token
      ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` }, fetch: homeFetch }, auth: { persistSession: false, autoRefreshToken: false } })
      : createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { fetch: homeFetch } });
  }
  return client;
}
