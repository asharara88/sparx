import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/server/csrf";
import { serviceClient } from "@/lib/server/member";
import { cleanupHome } from "@/lib/server/cleanup";
import { HOME_COOKIE, homeId } from "@/lib/home-cookie";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST {household_id, name} → delete that home. The database decides (household_delete:
 * an admin of the home, the name typed exactly, never the first home), takes every row
 * with it and queues the file cleanup. The files are removed here at once when the
 * server can; otherwise the daily cron retries, and the answer says which it is:
 * `cleanup` is "done" or "pending". Once the rows are gone nobody can reach the files
 * anyway. The device's home cookie is cleared when it named this home.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req.headers, req.url)) return NextResponse.json({ ok: false, error: "cross_site" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { household_id?: unknown; name?: unknown } | null;
  const id = homeId(typeof body?.household_id === "string" ? body.household_id : null);
  const name = typeof body?.name === "string" ? body.name : "";
  if (!id) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: false, error: "not_signed_in" }, { status: 401 });

  const { data, error } = await supabase.rpc("household_delete", { p_household_id: id, p_name: name });
  if (error) return NextResponse.json({ ok: false, error: "failed", message: error.message }, { status: 500 });
  const res = data as { ok: boolean; error?: string; message?: string; name?: string; members?: number; entries?: number };
  if (!res.ok) return NextResponse.json(res, { status: res.error === "denied" ? 403 : 400 });

  let cleanup: "done" | "pending" = "pending";
  let files: Record<string, number | string> = {};
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const r = await cleanupHome(serviceClient(), id);
      cleanup = r.done ? "done" : "pending";
      files = { ...r.removed, ...(r.error ? { error: r.error } : {}) };
    } catch (e) {
      files = { error: e instanceof Error ? e.message : String(e) };
    }
  } else {
    files = { error: "SUPABASE_SERVICE_ROLE_KEY is not set on the server: the cleanup waits for the daily job." };
  }
  const out = NextResponse.json({ ...res, cleanup, files });
  const cookie = req.headers.get("cookie") ?? "";
  if (new RegExp(`(?:^|;\\s*)${HOME_COOKIE}=${id}(?:;|$)`, "i").test(cookie)) out.cookies.set(HOME_COOKIE, "", { path: "/", maxAge: 0 });
  return out;
}
