import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";
import { PREVIEW_COOKIE, previewClient, verifyPreviewToken } from "@/lib/server/preview";
import { HOME_COOKIE, HOME_HEADER, homeId } from "@/lib/home-cookie";

/**
 * Supabase client for Server Components and Route Handlers (reads the user's cookies).
 * While an admin is in "view as", the preview token replaces the session for data calls,
 * so every screen renders as the previewed member. Pass { ignorePreview: true } for the
 * admin's own identity (starting or ending a preview, signing out). The home cookie the
 * device keeps goes along as the x-home header, so the server renders the home the device
 * is showing (lib/home-cookie.ts).
 */
export async function createClient(opts: { ignorePreview?: boolean } = {}) {
  const cookieStore = await cookies();
  if (process.env.FAMILY_LOCAL_DB) {
    // Screenshot mode against a local Postgres; the member comes from a cookie.
    const { localClient } = await import("./local");
    const as = cookieStore.get("shot_as")?.value ?? "00000000-0000-4000-8000-000000000001";
    return localClient(process.env.FAMILY_LOCAL_DB, as, `${as.slice(-4)}@local`);
  }
  if (!opts.ignorePreview) {
    const token = cookieStore.get(PREVIEW_COOKIE)?.value;
    if (token && (await verifyPreviewToken(token))) return previewClient(token);
  }
  const home = homeId(cookieStore.get(HOME_COOKIE)?.value);
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: home ? { headers: { [HOME_HEADER]: home } } : undefined,
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
