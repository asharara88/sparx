import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Me } from "@/lib/types";
import { can } from "@/lib/types";
import { meOnce } from "@/lib/server/me";
import { child } from "@/lib/names";
import { effortRows, type EffortSum } from "@/lib/effort";
import { dateWords } from "@/lib/time";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

/**
 * "Since {Name} was born" (DESIGN.md, "Effort, counted"): what was given, counted. A person
 * sees their own sums and the whole home's, one at a time, and never another member's. One
 * number a row; a kind with nothing saved is left out. No target, no bar, no comparison:
 * the screen has nothing to reach and nothing to fall short of.
 *
 * It opens on the viewer's own list when there is one. Someone with nothing saved under
 * their name (a grandmother who looks but does not log) gets the home's list and no switch:
 * the code never shows a single zero row, and a whole empty list is the same thing. In "view
 * as" the database answers the home's sums alone, so the same holds there.
 */
export default async function EffortPage({ searchParams }: { searchParams: Promise<{ who?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me | null;
  if (!me?.ok) redirect("/login");
  const kid = child(me);
  if (!kid || !can(me, "lana", "view")) redirect("/me");
  const { data } = await supabase.rpc("effort_totals", { p_subject_id: kid.id });
  const res = data as { ok?: boolean; all?: EffortSum; mine?: EffortSum | null } | null;
  const mine = res?.ok ? (res.mine ?? null) : null;
  const own = mine ? effortRows(mine, "you") : [];
  const everyone = sp.who === "all" || own.length === 0;
  const sum = res?.ok ? (everyone ? (res.all ?? null) : mine) : null;
  const rows = sum ? effortRows(sum, everyone ? "all" : "you") : [];
  // The first day of the list that is showing (a calendar day, shown as written): each list is
  // dated from its own start, so someone who joined last week is not dated from the birth.
  const first = sum?.first_day ?? null;
  const since = first ? dateWords(new Date(`${first}T12:00:00Z`), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/achievements" title={`Since ${kid.name} was born`} subtitle="What was given, counted. Nothing here is a goal." />
      {own.length > 0 && (
        <nav className="segmented" aria-label="Whose">
          <Link prefetch={false} replace href="/achievements/effort" aria-current={everyone ? undefined : "page"}>
            You
          </Link>
          <Link prefetch={false} replace href="/achievements/effort?who=all" aria-current={everyone ? "page" : undefined}>
            Everyone
          </Link>
        </nav>
      )}
      {rows.length > 0 ? (
        <ul className="card flex flex-col p-0">
          {rows.map((r) => (
            <li key={r.label} className="row px-4">
              <span className="min-w-0 flex-1 font-semibold">{r.label}</span>
              <span className="shrink-0 text-xl font-bold tabular-nums">{r.value}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="card muted">{res?.ok ? "Nothing is saved yet." : "Could not read the totals. Try again in a moment."}</p>
      )}
      {rows.length > 0 && <p className="muted text-sm">Counted from what was saved{since ? `, since ${since}` : ""}. What was not saved was still done.</p>}
    </div>
  );
}
