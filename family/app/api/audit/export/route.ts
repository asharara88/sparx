import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { AuditRow } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET → the audit log as CSV (what audit_recent returns, up to 5000 rows), for whoever may view it. */
export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("audit_recent", { p_limit: 5000 });
  const res = data as { ok: boolean; rows?: AuditRow[]; message?: string } | null;
  if (error || !res?.ok) return NextResponse.json({ ok: false, message: res?.message ?? error?.message ?? "Not allowed." }, { status: 403 });
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = ["at,actor,role,module,action,allowed,source,target_table,target_id,detail"];
  for (const r of res.rows ?? []) lines.push([r.at, r.actor, r.actor_role, r.module_id, r.action, r.allowed, r.source, r.target_table, r.target_id, r.detail ? JSON.stringify(r.detail) : ""].map(q).join(","));
  return new NextResponse(lines.join("\n"), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
