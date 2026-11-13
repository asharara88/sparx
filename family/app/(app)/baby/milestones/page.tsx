import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { EntryRow, HomeSummary, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { dayRange, fmtDate } from "@/lib/time";
import { ageDays, ageLabel } from "@/lib/norms";
import { Photo } from "@/components/Photo";
import { PageHeader } from "@/components/PageHeader";
import { Icon } from "@/components/Icon";
import { meOnce } from "@/lib/server/me";

export const dynamic = "force-dynamic";

/** The child's firsts, with the photo if one was added to the entry, and how old they were. */
export default async function MilestonesPage() {
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me;
  if (!can(me, "lana", "view")) redirect("/");
  const tz = me.household.timezone;
  const { data: sumData } = await supabase.rpc("home_summary");
  const summary = sumData as HomeSummary | RpcError;
  if (!summary.ok) redirect("/baby");
  const s = summary.subject;
  const from = s.birth_date ? dayRange(s.birth_date, tz).from : "2000-01-01T00:00:00Z";
  const { data: listData } = await supabase.rpc("care_entries_list", { p_subject_id: s.id, p_from: from, p_to: new Date(Date.now() + 86_400_000).toISOString() });
  const entries = (((listData as { entries?: EntryRow[] } | null)?.entries ?? []) as EntryRow[]).filter((e) => e.type_id === "lana.milestone");
  const ids = entries.map((e) => e.id);
  const { data: photos } = ids.length && can(me, "photos", "view") ? await supabase.from("attachments").select("entity_id, path").eq("entity_table", "care_entries").in("entity_id", ids).is("deleted_at", null).order("created_at") : { data: [] };
  const photoOf = new Map<string, string>();
  for (const p of (photos as { entity_id: string; path: string }[] | null) ?? []) if (!photoOf.has(p.entity_id)) photoOf.set(p.entity_id, p.path);
  const canAdd = can(me, "lana", "add");

  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/baby?tab=about" title="Firsts" subtitle={`${s.name}'s milestones, newest first.`} />
      {entries.length === 0 ? (
        <p className="muted px-1">Nothing written down yet: a first smile, a laugh, rolling over.</p>
      ) : (
        // One list, a row per first (DESIGN.md: list rows, not a card each): the photo when there is one.
        <ul className="card flex flex-col p-0">
          {entries.map((e) => {
            const photo = photoOf.get(e.id) ?? null;
            const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(e.occurred_at));
            const age = s.birth_date ? ageLabel(ageDays(s.birth_date, day)) : null;
            return (
              <li key={e.id}>
                <Link prefetch={false} href={`/baby/entry/${e.id}`} className="row row-link px-4">
                  {photo ? (
                    <Photo path={photo} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <span className="icon-disc tint-sleep" style={{ width: 36, height: 36 }}>
                      <Icon name="star" size={18} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{String(e.payload.what ?? "Milestone")}</span>
                    <span className="muted block text-sm">
                      {fmtDate(e.occurred_at, tz, { weekday: "short", day: "numeric", month: "short" })}
                      {age ? ` · ${age} old` : ""}
                    </span>
                  </span>
                  <Icon name="forward" size={18} className="muted" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {/* Adding a first is the screen's one action, at the thumb. */}
      {canAdd && (
        <div className="bottom-action">
          <Link prefetch={false} href="/baby/log/milestone" className="btn btn-primary btn-lg w-full">
            <Icon name="plus" size={20} /> Add a first
          </Link>
        </div>
      )}
    </div>
  );
}
