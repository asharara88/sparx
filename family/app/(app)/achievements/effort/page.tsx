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
  const res = data as { ok?: boolean; all?: EffortSum; mine?: EffortSum } | null;
  const everyone = sp.who === "all";
  const sum = res?.ok ? (everyone ? res.all : res.mine) : null;
  const rows = sum ? effortRows(sum) : [];
  // The first day anything was saved, for the line under the list (a calendar day, shown as written).
  const first = res?.ok ? (res.all?.first_day ?? null) : null;
  const since = first ? dateWords(new Date(`${first}T12:00:00Z`), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/achievements" title={`Since ${kid.name} was born`} subtitle="What was given, counted. Nothing here is a goal." />
      <nav className="segmented" aria-label="Whose">
        <Link prefetch={false} replace href="/achievements/effort" aria-current={everyone ? undefined : "page"}>
          You
        </Link>
        <Link prefetch={false} replace href="/achievements/effort?who=all" aria-current={everyone ? "page" : undefined}>
          Everyone
        </Link>
      </nav>
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
        <p className="card muted">{res?.ok ? (everyone ? "Nothing is saved yet." : "Nothing is saved under your name yet.") : "Could not read the totals. Pull down to try again."}</p>
      )}
      {rows.length > 0 && <p className="muted text-sm">Counted from what was saved{since ? `, since ${since}` : ""}. What was not saved was still done.</p>}
    </div>
  );
}
