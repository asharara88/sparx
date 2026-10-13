import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { EntryRow, HomeSummary, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { fmtDate } from "@/lib/time";
import { ageDays, ageLabel } from "@/lib/norms";
import { Photo } from "@/components/Photo";
import { PageHeader } from "@/components/PageHeader";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

/** Her firsts, with the photo if one was added to the entry, and how old she was. */
export default async function MilestonesPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "lana", "view")) redirect("/");
  const tz = me.household.timezone;
  const { data: sumData } = await supabase.rpc("home_summary");
  const summary = sumData as HomeSummary | RpcError;
  if (!summary.ok) redirect("/lana");
  const s = summary.subject;
  const from = s.birth_date ? `${s.birth_date}T00:00:00Z` : "2000-01-01T00:00:00Z";
  const { data: listData } = await supabase.rpc("care_entries_list", { p_subject_id: s.id, p_from: from, p_to: new Date(Date.now() + 86_400_000).toISOString() });
  const entries = (((listData as { entries?: EntryRow[] } | null)?.entries ?? []) as EntryRow[]).filter((e) => e.type_id === "lana.milestone");
  const ids = entries.map((e) => e.id);
  const { data: photos } = ids.length && can(me, "photos", "view") ? await supabase.from("attachments").select("entity_id, path").eq("entity_table", "care_entries").in("entity_id", ids).is("deleted_at", null).order("created_at") : { data: [] };
  const photoOf = new Map<string, string>();
  for (const p of (photos as { entity_id: string; path: string }[] | null) ?? []) if (!photoOf.has(p.entity_id)) photoOf.set(p.entity_id, p.path);
  const canAdd = can(me, "lana", "add");

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back="/lana"
        title="Firsts"
        subtitle={`${s.name}'s milestones, newest first.`}
        action={
          canAdd ? (
            <Link href="/lana/log/milestone" className="btn btn-primary" style={{ minHeight: 40 }}>
              <Icon name="plus" size={18} /> Add
            </Link>
          ) : undefined
        }
      />
      {entries.length === 0 ? (
        <div className="card">
          <p className="font-semibold">Nothing written down yet.</p>
          <p className="muted mt-1 text-sm">First smile, first laugh, rolled over, slept through. Add one, then put a photo on it from the entry.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {entries.map((e) => {
            const photo = photoOf.get(e.id) ?? null;
            const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(e.occurred_at));
            const age = s.birth_date ? ageLabel(ageDays(s.birth_date, day)) : null;
            return (
              <li key={e.id}>
                <Link href={`/lana/entry/${e.id}`} className="card flex gap-3 no-underline">
                  {photo ? (
                    <Photo path={photo} alt="" className="h-24 w-24 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <span className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)]">
                      <Icon name="star" size={28} className="text-[var(--accent)]" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-lg font-semibold">{String(e.payload.what ?? "Milestone")}</span>
                    <span className="muted block text-sm">
                      {fmtDate(e.occurred_at, tz, { weekday: "short", day: "numeric", month: "long" })}
                      {age ? ` · ${age} old` : ""}
                    </span>
                    {e.note && <span className="muted block text-sm">{e.note}</span>}
                    {!photo && canAdd && <span className="block text-sm text-[var(--accent)]">Add a photo ›</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
