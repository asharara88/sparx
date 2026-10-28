import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { HomeSummary, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { ageDays } from "@/lib/norms";
import { todayYmd } from "@/lib/time";
import { BANDS, leapWeek } from "@/lib/leaps";
import { PageHeader } from "@/components/PageHeader";
import { meOnce } from "@/lib/server/me";

export const dynamic = "force-dynamic";

/** Week by week to three years: what each stretch usually brings, with the child's week marked. */
export default async function WeeksPage() {
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me;
  if (!can(me, "lana", "view")) redirect("/");
  const { data: sumData } = await supabase.rpc("home_summary");
  const summary = sumData as HomeSummary | RpcError;
  if (!summary.ok) redirect("/baby");
  const s = summary.subject;
  const today = todayYmd(me.household.timezone);
  const days = s.birth_date ? ageDays(s.birth_date, today) : null;
  const now = days != null ? leapWeek(days) : null;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/baby" title="Week by week" subtitle={now ? `${s.name} is in week ${now.week}: ${now.band.title.toLowerCase()}.` : `What each stretch of the first three years usually brings.`} />
      {now && (
        <section className="card ring-2 ring-[var(--accent)]" aria-labelledby="now-h">
          <p className="muted text-xs">
            Week {now.week} · week {now.weekInBand} of this stretch{now.next && now.weeksToNext != null ? ` · next: ${now.next.title.toLowerCase()} in ${now.weeksToNext} week${now.weeksToNext === 1 ? "" : "s"}` : ""}
          </p>
          <h2 id="now-h" className="text-xl font-semibold">
            {now.band.title} {now.band.tough && <span className="pill">often a harder stretch</span>}
          </h2>
          <p className="mt-1">{now.band.expect}</p>
          <p className="notice mt-2 text-sm font-semibold">{now.band.tip}</p>
          <p className="muted mt-1 text-xs">Source: {now.band.source}</p>
        </section>
      )}
      <ol className="flex flex-col gap-2">
        {BANDS.map((b) => {
          const state = now ? (b.toWeek < now.band.fromWeek ? "past" : b.fromWeek === now.band.fromWeek ? "now" : "ahead") : "ahead";
          return (
            <li key={b.fromWeek} className={`card-flat ${state === "past" ? "opacity-60" : ""}`}>
              <p className="muted text-xs">
                Weeks {b.fromWeek} to {b.toWeek}
                {state === "now" ? " · now" : ""}
                {b.tough ? " · often harder" : ""}
              </p>
              <p className="font-semibold">{b.title}</p>
              <p className="text-sm">{b.expect}</p>
              <p className="muted mt-1 text-sm">Try: {b.tip}</p>
              <p className="muted text-xs">{b.source}</p>
            </li>
          );
        })}
      </ol>
      <p className="muted text-xs">Ages are typical, not deadlines. The doctor checks development at each visit; the "When to call" page lists the signs that need a call.</p>
    </div>
  );
}
