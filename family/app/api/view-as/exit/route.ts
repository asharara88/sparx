import { NextResponse } from "next/server";
import { PREVIEW_COOKIE } from "@/lib/server/preview";

/**
 * GET: end "view as" and go home. The layout sends the admin here when the preview
 * token stops being accepted (the project's JWT secret changed, say): without this
 * the admin was signed out in appearance only, for up to an hour, with no "Back to
 * me" button on screen. Ending a read-only preview is harmless, so a plain GET is fine.
 */
export async function GET(request: Request) {
  const res = NextResponse.redirect(new URL("/", new URL(request.url).origin), { status: 303 });
  res.cookies.set(PREVIEW_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
