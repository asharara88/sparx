import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { serviceClient } from "@/lib/server/member";
import { runBackupFor } from "@/lib/backup/run";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function admin() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase.rpc("me");
  const me = data as Me | RpcError | null;
  return me && me.ok && can(me, "audit", "view") && !me.preview ? me : null;
}

/** GET ?path=run-…/file → a one-hour link to that backup file (audit viewers only). */
export async function GET(req: Request) {
  const me = await admin();
  if (!me) return NextResponse.json({ ok: false, error: "not_allowed" }, { status: 403 });
  const path = new URL(req.url).searchParams.get("path") ?? "";
  // Backups live per home: home-<id>/run-<stamp>/<table>; only your own home's.
  // Runs from before many homes (run-<stamp>/…) belong to the first home.
  const m = /^(?:home-([0-9a-f-]{36})\/)?run-[0-9-]+\/[a-z_]+\.(json|json\.gz)$/.exec(path);
  if (!m) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  const mine = m[1] ? m[1] === me.household.id : me.platform === true;
  if (!mine) return NextResponse.json({ ok: false, error: "not_allowed" }, { status: 403 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ ok: false, error: "not_configured", message: "SUPABASE_SERVICE_ROLE_KEY is not set on the server." }, { status: 503 });
  const { data, error } = await serviceClient().storage.from("backups").createSignedUrl(path, 3600);
  if (error || !data) return NextResponse.json({ ok: false, error: "not_found", message: error?.message }, { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}

/** POST → run a backup of the caller's home now (audit viewers only). The nightly cron does every home. */
export async function POST() {
  const me = await admin();
  if (!me) return NextResponse.json({ ok: false, error: "not_allowed" }, { status: 403 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ ok: false, error: "not_configured", message: "SUPABASE_SERVICE_ROLE_KEY is not set on the server." }, { status: 503 });
  try {
    const r = await runBackupFor(me.household.id);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "failed", message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
