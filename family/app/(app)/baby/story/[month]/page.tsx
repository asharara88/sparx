import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { childPronouns } from "@/lib/names";
import type { DailyStats, EntryRow, HomeSummary, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { fmtDate, todayYmd } from "@/lib/time";
import { ageLabel } from "@/lib/norms";
import { currentMonth, storyMonth } from "@/lib/story";
import { getBrief } from "@/lib/assistant/brief";
import { reference } from "@/lib/who";
import { Photo } from "@/components/Photo";
import { PageHeader } from "@/components/PageHeader";
import { PrintButton } from "@/components/PrintButton";
import { Icon } from "@/components/Icon";
import { meOnce } from "@/lib/server/me";

export const dynamic = "force-dynamic";

/**
 * One month of the child's life on a page: the firsts with their photos, the numbers,
 * what was tried, and the helper's paragraph. Printable.
 */
export default async function StoryPage({ params }: { params: Promise<{ month: string }> }) {
  const { month: monthParam } = await params;
  const month = Number(monthParam);
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me;
  if (!can(me, "lana", "view")) redirect("/");
  const tz = me.household.timezone;
  const today = todayYmd(tz);
  const { data: sumData } = await supabase.rpc("home_summary");
  const summary = sumData as HomeSummary | RpcError;
  if (!summary.ok || !summary.subject.birth_date) redirect("/baby");
  const s = summary.subject;
  const birth = s.birth_date!;
  const span = Number.isInteger(month) ? storyMonth(birth, month, today) : null;
  if (!span) redirect("/baby/story");
  const latest = currentMonth(birth, today);

  const [{ data: statsData }, { data: listData }, story] = await Promise.all([
    supabase.rpc("care_daily_stats", { p_subject_id: s.id, p_from: span.from, p_to: span.to }),
    supabase.rpc("care_entries_list", { p_subject_id: s.id, p_from: `${span.from}T00:00:00Z`, p_to: `${span.to}T23:59:59Z` }),
    can(me, "assistant", "view") ? getBrief(supabase, me, "story", false, { month }).catch(() => null) : Promise.resolve(null),
  ]);
  const stats = statsData as DailyStats | RpcError | null;
  const days = stats?.ok ? stats.days : [];
  const entries = ((listData as { entries?: EntryRow[] } | null)?.entries ?? []) as EntryRow[];
  const firsts = entries.filter((e) => e.type_id === "lana.milestone").sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const ids = firsts.map((e) => e.id);
  const { data: photos } = ids.length && can(me, "photos", "view") ? await supabase.from("attachments").select("entity_id, path").eq("entity_table", "care_entries").in("entity_id", ids).is("deleted_at", null).order("created_at") : { data: [] };
  const photoOf = new Map<string, string>();
  for (const p of (photos as { entity_id: string; path: string }[] | null) ?? []) if (!photoOf.has(p.entity_id)) photoOf.set(p.entity_id, p.path);
  const { data: doneData } = await supabase.rpc("activity_done_list", { p_subject_id: s.id, p_from: span.from, p_to: span.to });
  const tried = (((doneData as { items?: { id: string; title: string; done_on: string; done_by: string | null }[] } | null)?.items ?? []) as { id: string; title: string; done_on: string; done_by: string | null }[]);

  const sum = (k: keyof DailyStats["days"][number]) => days.reduce((a, d) => a + Number(d[k] ?? 0), 0);
  const weights = days.filter((d) => d.weight_kg != null);
  const w0 = weights[0] ?? null;
  const w1 = weights[weights.length - 1] ?? null;
  const ageEnd = Math.floor((Date.parse(span.to) - Date.parse(birth)) / 86_400_000);
  const ref = w1 ? reference("weight_kg", Math.floor((Date.parse(w1.day) - Date.parse(birth)) / 86_400_000)) : null;
  const sleepPerDay = days.length ? sum("sleep_min") / days.length : 0;
  const longest = Math.max(0, ...days.map((d) => Number(d.longest_stretch_min ?? 0)));
  const hm = (min: number) => `${Math.floor(min / 60)} h${min % 60 ? ` ${Math.round(min % 60)} min` : ""}`;
  const numbers: [string, string][] = [];
  if (days.length) {
    const feeds = sum("breast_count") + sum("bottle_count");
    if (feeds) numbers.push(["Feeds", `${feeds}${sum("bottle_ml") ? `, ${Math.round(sum("bottle_ml") / 1000)} litres from bottles` : ""}`]);
    if (sleepPerDay) numbers.push(["Sleep a day", hm(sleepPerDay)]);
    if (longest) numbers.push(["Longest stretch", hm(longest)]);
    const nappies = sum("diapers_wet") + sum("diapers_dirty");
    if (nappies) numbers.push(["Nappies", String(nappies)]);
    if (w1) numbers.push(["Weight", `${w1.weight_kg} kg${w0 && w0.day !== w1.day ? ` (from ${w0.weight_kg} kg)` : ""}${ref ? `, WHO median ${ref.p50.toFixed(1)} kg` : ""}`]);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back="/baby"
        title={`${s.name}'s month ${month}`}
        subtitle={`${fmtDate(`${span.from}T12:00:00Z`, "UTC", { day: "numeric", month: "long", weekday: undefined })} to ${fmtDate(`${span.to}T12:00:00Z`, "UTC", { day: "numeric", month: "long", weekday: undefined })}${span.inProgress ? ", so far" : ""}. ${ageLabel(ageEnd)} old at the end.`}
        action={<PrintButton label="Print or save" />}
      />
      <nav className="no-print flex items-center justify-between text-sm">
        {month > 1 ? (
          <Link href={`/baby/story/${month - 1}`} className="btn">
            <Icon name="back" size={16} /> Month {month - 1}
          </Link>
        ) : (
          <span />
        )}
        {month < latest ? (
          <Link href={`/baby/story/${month + 1}`} className="btn">
            Month {month + 1} <Icon name="forward" size={16} />
          </Link>
        ) : (
          <span />
        )}
      </nav>

      {story && story.ok && (
        <section className="card">
          <p className="whitespace-pre-wrap text-lg leading-relaxed">{story.brief.content}</p>
          <p className="muted mt-2 text-xs">Written by the helper from the log{span.inProgress ? "; it is rewritten each day while the month runs" : ""}.</p>
        </section>
      )}
      {story && !story.ok && story.error !== "not_allowed" && <p className="muted text-sm">The helper's paragraph is not available right now ({story.message}).</p>}

      {firsts.length > 0 && (
        <section className="card" aria-labelledby="firsts-h">
          <h2 id="firsts-h" className="font-semibold">
            Firsts
          </h2>
          <ul className="mt-2 flex flex-col gap-3">
            {firsts.map((e) => {
              const photo = photoOf.get(e.id) ?? null;
              return (
                <li key={e.id} className="flex gap-3">
                  {photo ? (
                    <Photo path={photo} alt="" className="h-28 w-28 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)]">
                      <Icon name="star" size={24} className="text-[var(--accent)]" />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block text-lg font-semibold">{String(e.payload.what ?? "Milestone")}</span>
                    <span className="muted block text-sm">{fmtDate(e.occurred_at, tz, { day: "numeric", month: "long" })}</span>
                    {e.note && <span className="muted block text-sm">{e.note}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {numbers.length > 0 && (
        <section className="card" aria-labelledby="numbers-h">
          <h2 id="numbers-h" className="font-semibold">
            The month in numbers
          </h2>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {numbers.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="muted">{k}</dt>
                <dd className="font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="muted mt-1 text-xs">
            {days.length} day{days.length === 1 ? "" : "s"} with something logged.
          </p>
        </section>
      )}

      {tried.length > 0 && (
        <section className="card" aria-labelledby="tried-h">
          <h2 id="tried-h" className="font-semibold">
            What you tried
          </h2>
          <ul className="mt-1 flex flex-col gap-0.5 text-sm">
            {tried.map((a) => (
              <li key={a.id}>
                {a.title} <span className="muted">· {a.done_on.slice(5)}{a.done_by ? ` · ${a.done_by}` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {days.length === 0 && firsts.length === 0 && (
        <p className="card muted">Nothing was logged in this month.</p>
      )}
      <p className="muted no-print text-xs">A page like this is written for every month on {childPronouns(me).their} monthly birthday. Add a photo to a first from its entry and it appears here.</p>
    </div>
  );
}
