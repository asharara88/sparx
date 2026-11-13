import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { HomeSummary, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { ageDays } from "@/lib/norms";
import { todayYmd } from "@/lib/time";
import { BANDS, leapWeek } from "@/lib/leaps";
import { PageHeader } from "@/components/PageHeader";
import { Fold } from "@/components/Fold";
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
  // The stretch she is in, open; the next three as flat folds; the rest folded away (DESIGN.md:
  // a reference page over 2.5 screens is split; 20 stretches written out ran 5.6 screens).
  const idx = now ? BANDS.findIndex((b) => b.fromWeek === now.band.fromWeek) : -1;
  const past = idx > 0 ? BANDS.slice(0, idx) : [];
  const next = now ? BANDS.slice(idx + 1, idx + 4) : BANDS;
  const later = now ? BANDS.slice(idx + 4) : [];
  const weeks = (b: (typeof BANDS)[number]) => `weeks ${b.fromWeek} to ${b.toWeek}`;
  const body = (b: (typeof BANDS)[number]) => (
    <div className="flex flex-col gap-1 text-sm">
      <p className="muted">
        {weeks(b)[0].toUpperCase() + weeks(b).slice(1)}
        {b.tough ? " · often harder" : ""}
      </p>
      <p>{b.expect}</p>
      <p className="font-semibold">Try: {b.tip}</p>
      <p className="muted">{b.source}</p>
    </div>
  );
  const plain = (list: typeof BANDS) => (
    <ul className="flex flex-col">
      {list.map((b) => (
        <li key={b.fromWeek} className="row flex-col items-stretch gap-1">
          <span className="font-semibold">{b.title}</span>
          <span className="muted text-sm">
            {weeks(b)}
            {b.tough ? " · often harder" : ""}
          </span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/baby?tab=about" title="Week by week" subtitle={now ? `${s.name} is in week ${now.week}.` : `What each stretch of the first three years usually brings.`} />
      {now && (
        <section className="card flex flex-col gap-1" aria-labelledby="now-h">
          <p className="muted text-sm">
            Week {now.week} · week {now.weekInBand} of this stretch{now.next && now.weeksToNext != null ? ` · next in ${now.weeksToNext} week${now.weeksToNext === 1 ? "" : "s"}` : ""}
          </p>
          <h2 id="now-h" className="text-xl font-semibold">
            {now.band.title}
          </h2>
          {now.band.tough && <span className="pill self-start">often a harder stretch</span>}
          <p>{now.band.expect}</p>
          <p className="mt-1 font-semibold">Try: {now.band.tip}</p>
          <p className="muted text-sm">Source: {now.band.source}</p>
        </section>
      )}
      {next.length > 0 && (
        <section className="flex flex-col gap-2" aria-label={now ? "Coming up" : "Each stretch"}>
          {now && <h2 className="section-title">Coming up</h2>}
          <div className="card flex flex-col p-0">
            {next.map((b) => (
              <Fold key={b.fromWeek} className="fold-flat" title={b.title} wrap>
                {body(b)}
              </Fold>
            ))}
          </div>
        </section>
      )}
      {later.length > 0 && (
        <Fold title="Later" hint={`to ${Math.round(BANDS[BANDS.length - 1].toWeek / 52)} years`}>
          {plain(later)}
        </Fold>
      )}
      {past.length > 0 && <Fold title="Earlier weeks">{plain(past)}</Fold>}
      <p className="muted text-sm">Ages are typical, not deadlines. The doctor checks development at each visit; the "When to call" page lists the signs that need a call.</p>
    </div>
  );
}
