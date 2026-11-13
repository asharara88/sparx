import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AuditRow, BackupRow, JobRun, Me } from "@/lib/types";
import { can } from "@/lib/types";
import { addDays, fmtDate, fmtTime, todayYmd, ymdInZone } from "@/lib/time";
import { childName, possessive } from "@/lib/names";
import { PageHeader } from "@/components/PageHeader";
import { BackupsCard } from "@/components/BackupsCard";
import { meOnce } from "@/lib/server/me";

export const dynamic = "force-dynamic";

/** What someone did, in words: "added to", "changed"; a refused attempt is what they tried. */
const DID: Record<string, string> = { add: "added to", edit: "changed", delete: "deleted from", view: "opened" };
const TRIED: Record<string, string> = { add: "tried to add to", edit: "tried to change", delete: "tried to delete from", view: "tried to open" };
/** The helper's own actions (assistant_audit's kinds, the suggestions), said whole: done, then tried. */
const HELPER: Record<string, [string, string]> = {
  ask: ["asked the helper", "tried to ask the helper"],
  brief: ["got a brief from the helper", "tried to get a brief from the helper"],
  plan: ["got a plan from the helper", "tried to get a plan from the helper"],
  story: ["got a story from the helper", "tried to get a story from the helper"],
  milk_scan: ["had the helper read a milk label", "tried to have the helper read a milk label"],
  remember: ["had the helper read the chat", "tried to have the helper read the chat"],
  dismiss: ["dropped a suggestion", "tried to drop a suggestion"],
  approve: ["kept a suggestion", "tried to keep a suggestion"],
};

/** How many rows a page shows first, and how many more "Show older" adds. The CSV has them all. */
const FIRST = 50;
const MORE = 100;
const MOST = 1000;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me;
  if (!can(me, "audit", "view")) redirect("/");
  // audit_recent takes only a limit, so older rows come by asking for more of them.
  const n = Math.min(Math.max(Math.floor(Number((await searchParams).n)) || FIRST, 1), MOST);
  const [{ data }, { data: backups }, { data: runsData }, { data: modules }, { data: roles }] = await Promise.all([
    supabase.rpc("audit_recent", { p_limit: n }),
    supabase.from("backups").select("*").order("created_at", { ascending: false }).limit(10),
    supabase.rpc("job_runs_list"),
    supabase.from("modules").select("id, label"),
    supabase.from("roles").select("id, label"),
  ]);
  const rows = ((data as { ok: boolean; rows?: AuditRow[] })?.rows ?? []) as AuditRow[];
  const runs = ((runsData as { ok: boolean; runs?: JobRun[] })?.runs ?? []) as JobRun[];
  const tz = me.household.timezone;

  // The family's words for modules and roles, never their ids; the child's log is named after her.
  const moduleLabel = new Map(
    ((modules as { id: string; label: string }[] | null) ?? []).map((m) => [m.id, m.id === "lana" ? `${possessive(childName(me))} log` : m.id === "assistant" ? "the helper" : m.label]),
  );
  const roleLabel = new Map(((roles as { id: string; label: string }[] | null) ?? []).map((r) => [r.id, r.label]));

  // One list per day, newest first, under "Today", "Yesterday", then the date.
  const today = todayYmd(tz);
  const days: { key: string; title: string; rows: AuditRow[] }[] = [];
  for (const r of rows) {
    const key = ymdInZone(new Date(r.at), tz);
    let group = days[days.length - 1];
    if (!group || group.key !== key) {
      group = { key, title: key === today ? "Today" : key === addDays(today, -1) ? "Yesterday" : fmtDate(r.at, tz), rows: [] };
      days.push(group);
    }
    group.rows.push(r);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back="/me"
        title="Audit log"
        subtitle="Who did what, newest first."
        action={
          <a href="/api/audit/export" className="btn">
            Download
          </a>
        }
      />
      <BackupsCard rows={((backups as BackupRow[] | null) ?? []) as BackupRow[]} runs={runs} tz={tz} />
      {days.map((d) => (
        <section key={d.key} className="flex flex-col gap-2" aria-label={d.title}>
          <h2 className="section-title">{d.title}</h2>
          <ul className="card flex flex-col p-0">
            {d.rows.map((r) => {
              // A module that has since gone (the retired shopping list) keeps a readable name, never an id.
              const what = r.module_id ? (moduleLabel.get(r.module_id) ?? r.module_id.replace(/_/g, " ")) : "the app";
              const helper = r.module_id === "assistant" && r.action ? HELPER[r.action] : undefined;
              // An action with no words yet says "used", never its raw id.
              const did = helper
                ? helper[r.allowed ? 0 : 1]
                : `${(r.action && (r.allowed ? DID : TRIED)[r.action]) || (r.allowed ? "used" : "tried to use")} ${what}`;
              const who = [r.actor_role ? (roleLabel.get(r.actor_role) ?? r.actor_role) : null, r.source === "agent" ? "by the helper" : null].filter(Boolean).join(" · ");
              return (
                <li key={r.id} className="row px-4">
                  <span className="min-w-0 flex-1">
                    <span className="block">
                      {fmtTime(r.at, tz)} · {r.actor ?? "Someone"} {did}
                    </span>
                    {who && <span className="muted block truncate text-sm">{who}</span>}
                  </span>
                  {!r.allowed && <span className="pill pill-danger shrink-0">Refused</span>}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {rows.length === 0 && <p className="muted">Nothing yet.</p>}
      {rows.length >= n && n < MOST && (
        <Link prefetch={false} scroll={false} href={`/audit?n=${Math.min(n + MORE, MOST)}`} className="btn btn-ghost w-full">
          Show older
        </Link>
      )}
    </div>
  );
}
