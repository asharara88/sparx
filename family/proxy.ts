import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isConfigured } from "@/lib/env";
import { PREVIEW_COOKIE } from "@/lib/server/preview";

/**
 * Keeps the Supabase session cookies fresh on every request so Server
 * Components always see a valid user. One routing decision: someone who is not
 * signed in and opens elnunu.com itself sees the landing page (/welcome), not the
 * sign-in form; deeper links still go to /login from the app's layout.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (!isConfigured()) return response;

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  // Screenshot mode (FAMILY_LOCAL_DB, never set in production) has no Supabase session to find.
  if (!data.user && request.nextUrl.pathname === "/" && !request.cookies.get(PREVIEW_COOKIE)?.value && !process.env.FAMILY_LOCAL_DB) {
    const to = request.nextUrl.clone();
    to.pathname = "/welcome";
    to.search = "";
    return NextResponse.redirect(to);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|sw.js|manifest.webmanifest).*)"],
};
