import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/server/csrf";
import { serviceClient } from "@/lib/server/member";
import { removeFolder } from "@/lib/server/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST {household_id, name} → delete that home. The database decides (household_delete:
 * an admin of the home, the name typed exactly, never the first home) and takes every
 * row with it; then the home's files go from the photos and backups buckets. Once the
 * rows are gone nobody can reach the files anyway, so a cleanup that fails is reported,
 * not fatal.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req.headers, req.url)) return NextResponse.json({ ok: false, error: "cross_site" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { household_id?: unknown; name?: unknown } | null;
  const id = typeof body?.household_id === "string" ? body.household_id : "";
  const name = typeof body?.name === "string" ? body.name : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: false, error: "not_signed_in" }, { status: 401 });

  const { data, error } = await supabase.rpc("household_delete", { p_household_id: id, p_name: name });
  if (error) return NextResponse.json({ ok: false, error: "failed", message: error.message }, { status: 500 });
  const res = data as { ok: boolean; error?: string; message?: string; name?: string; members?: number; entries?: number };
  if (!res.ok) return NextResponse.json(res, { status: res.error === "denied" ? 403 : 400 });

  const files: Record<string, number | string> = {};
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const svc = serviceClient();
    for (const bucket of ["photos", "backups"]) {
      try {
        files[bucket] = await removeFolder(svc, bucket, `home-${id}`);
      } catch (e) {
        files[bucket] = `left behind: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
  } else {
    files.note = `SUPABASE_SERVICE_ROLE_KEY is not set on the server: the folder home-${id} in the photos and backups buckets was left behind.`;
  }
  return NextResponse.json({ ...res, files });
}
