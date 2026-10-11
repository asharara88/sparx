import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AuditRow, Me } from "@/lib/types";
import { can } from "@/lib/types";
import { fmtDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "audit", "view")) redirect("/");
  const { data } = await supabase.rpc("audit_recent", { p_limit: 300 });
  const rows = ((data as { ok: boolean; rows?: AuditRow[] })?.rows ?? []) as AuditRow[];
  const tz = me.household.timezone;
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3 pt-2">
        <Link href="/" className="btn" aria-label="Back">
          ‹
        </Link>
        <h1 className="text-2xl font-bold">Audit log</h1>
      </header>
      <p className="muted">Every write, and every attempt that was not allowed. Newest first.</p>
      <ul className="flex flex-col gap-2 text-sm">
        {rows.map((r) => (
          <li key={r.id} className={`card ${r.allowed ? "" : "border-red-700"}`}>
            <div className="flex justify-between gap-2">
              <span className="font-semibold">
                {r.actor ?? "unknown"} <span className="muted">({r.actor_role ?? "-"})</span>
              </span>
              <span className="muted">{fmtDateTime(r.at, tz)}</span>
            </div>
            <div>
              {r.allowed ? "✅" : "⛔"} {r.source === "agent" ? "🤖 " : ""}{r.action} {r.module_id}
              {r.target_table ? ` · ${r.target_table}` : ""}
              {r.target_id ? ` · ${r.target_id.slice(0, 8)}` : ""}
              {r.detail ? ` · ${JSON.stringify(r.detail)}` : ""}
            </div>
          </li>
        ))}
        {rows.length === 0 && <li className="muted">Nothing yet.</li>}
      </ul>
    </div>
  );
}
