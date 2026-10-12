import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";
import { PREVIEW_COOKIE, previewClient, verifyPreviewToken } from "@/lib/server/preview";

/**
 * Supabase client for Server Components and Route Handlers (reads the user's cookies).
 * While an admin is in "view as", the preview token replaces the session for data calls,
 * so every screen renders as the previewed member. Pass { ignorePreview: true } for the
 * admin's own identity (starting or ending a preview, signing out).
 */
export async function createClient(opts: { ignorePreview?: boolean } = {}) {
  const cookieStore = await cookies();
  if (!opts.ignorePreview) {
    const token = cookieStore.get(PREVIEW_COOKIE)?.value;
    if (token && (await verifyPreviewToken(token))) return previewClient(token);
  }
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies are refreshed by proxy.ts instead.
        }
      },
    },
  });
}
