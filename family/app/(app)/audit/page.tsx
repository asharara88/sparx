import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AuditRow, BackupRow, JobRun, Me } from "@/lib/types";
import { can } from "@/lib/types";
import { fmtDateTime } from "@/lib/time";
import { PageHeader } from "@/components/PageHeader";
import { Icon } from "@/components/Icon";
import { BackupsCard } from "@/components/BackupsCard";
import { meOnce } from "@/lib/server/me";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me;
  if (!can(me, "audit", "view")) redirect("/");
  const { data } = await supabase.rpc("audit_recent", { p_limit: 300 });
  const rows = ((data as { ok: boolean; rows?: AuditRow[] })?.rows ?? []) as AuditRow[];
  const { data: backups } = await supabase.from("backups").select("*").order("created_at", { ascending: false }).limit(10);
  const { data: runsData } = await supabase.rpc("job_runs_list");
  const runs = ((runsData as { ok: boolean; runs?: JobRun[] })?.runs ?? []) as JobRun[];
  const tz = me.household.timezone;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/" title="Audit log" action={<a href="/api/audit/export" className="btn" style={{ minHeight: 40 }}>CSV</a>} />
      <BackupsCard rows={((backups as BackupRow[] | null) ?? []) as BackupRow[]} runs={runs} tz={tz} />
      <p className="muted">Every write, and every attempt that was not allowed. Newest first.</p>
      <ul className="flex flex-col gap-2 text-sm">
        {rows.map((r) => (
          <li key={r.id} className={`card ${r.allowed ? "" : "ring-1 ring-[var(--danger)]"}`}>
            <div className="flex justify-between gap-2">
              <span className="font-semibold">
                {r.actor ?? "unknown"} <span className="muted">({r.actor_role ?? "-"})</span>
              </span>
              <span className="muted">{fmtDateTime(r.at, tz)}</span>
            </div>
            <div>
              <Icon name={r.allowed ? "check" : "x"} size={16} className="inline" /> {r.source === "agent" ? "AI · " : ""}{r.action} {r.module_id}
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
