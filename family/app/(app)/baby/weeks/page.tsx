import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { HomeSummary, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { ageDays } from "@/lib/norms";
import { todayYmd } from "@/lib/time";
import { BANDS, leapWeek, startsIn, stretchHref, stretchNav } from "@/lib/leaps";
import { PageHeader } from "@/components/PageHeader";
import { Pager } from "@/components/DayPager";
import { Fold } from "@/components/Fold";
import { meOnce } from "@/lib/server/me";

export const dynamic = "force-dynamic";

/**
 * Week by week to three years, one stretch a card (DESIGN.md, "Week by week"; redrawn 24
 * November with Sprouty's cards in mind, in the frame Feeds and Sleep got). The pager names
 * the stretch ("Now" over "Weeks 21 to 25"); its arrows and a swipe go to the one before and
 * after, and the screen opens on the stretch the child is in. The card: her week and how far
 * through the stretch she is, what the stretch brings, one thing to try, the source. Under
 * it, a line of marks from birth to three years with her place and the card's; then every
 * stretch by name in one fold, to jump to one. Until now only four stretches could be read:
 * hers and the next three; the rest were titles in two folds.
 */
export default async function WeeksPage({ searchParams }: { searchParams: Promise<{ stretch?: string | string[] }> }) {
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
  const nav = stretchNav((await searchParams).stretch, days);
  const band = BANDS[nav.index];
  const weeks = (b: (typeof BANDS)[number]) => `weeks ${b.fromWeek} to ${b.toWeek}`;
  const cap = (t: string) => t[0].toUpperCase() + t.slice(1);
  // Where the card is from her: her own stretch, the next, or further either way.
  const off = nav.current == null ? null : nav.index - nav.current;
  const hers = off === 0 && now ? now : null;
  const length = band.toWeek - band.fromWeek + 1;
  const years = Math.round(BANDS[BANDS.length - 1].toWeek / 52);
  const place = `Stretch ${nav.index + 1} of ${BANDS.length}`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/baby?tab=about" title="Week by week" />
      <Pager
        prev={stretchHref(nav.prev, nav.home)}
        next={stretchHref(nav.next, nav.home)}
        title={off == null ? cap(weeks(band)) : off === 0 ? "Now" : off === 1 ? "Next" : off < 0 ? "Earlier" : "Later"}
        sub={off == null ? null : cap(weeks(band))}
        label="Stretches"
        prevLabel="The stretch before"
        nextLabel="The stretch after"
      />
      <section className="card tint-guide flex flex-col gap-2" aria-labelledby="stretch-h">
        <p className="flex items-baseline justify-between gap-2 text-[0.85rem]">
          <b>{hers ? `Week ${hers.week}` : cap(weeks(band))}</b>
          {hers ? <span className="opacity-90">week {hers.weekInBand} of {length}</span> : now && off != null && off > 0 ? <span className="opacity-90">{startsIn(band.fromWeek - now.week)}</span> : null}
        </p>
        {hers && (
          <div className="nap-bar" role="img" aria-label={`Week ${hers.weekInBand} of ${length} in this stretch`}>
            <span className="nap-bar-fill" style={{ width: `${Math.round((hers.weekInBand / length) * 100)}%` }} />
          </div>
        )}
        <h2 id="stretch-h" className="card-head">
          {band.title}
        </h2>
        {band.tough && <span className="pill self-start">often a harder stretch</span>}
        <h3 className="section-title mt-1 p-0">What it brings</h3>
        <p>{band.expect}</p>
        <h3 className="section-title mt-1 p-0">Try</h3>
        <p>{band.tip}</p>
        <p className="text-[0.85rem] opacity-90">Source: {band.source}</p>
      </section>
      <figure className="stretch-pos" role="img" aria-label={`${place}, from birth to ${years} years${nav.current != null && off !== 0 ? `. ${s.name} is in stretch ${nav.current + 1}` : ""}`}>
        <span className="stretch-path">
          {BANDS.map((b, i) => (
            <i key={b.fromWeek} className={[i < nav.behind ? "done" : "", i === nav.current ? "here" : "", i === nav.index ? "view" : ""].filter(Boolean).join(" ") || undefined} />
          ))}
        </span>
        <figcaption>
          <span>birth</span>
          <span>{place.toLowerCase()}</span>
          <span>{years} years</span>
        </figcaption>
      </figure>
      <Fold title="All the stretches" hint={`birth to ${years} years`}>
        <ul className="flex flex-col">
          {BANDS.map((b, i) => (
            <li key={b.fromWeek} className="row p-0">
              <Link prefetch={false} href={stretchHref(i, nav.home)!} className="row-link flex min-h-[52px] w-full items-center gap-3 py-2" aria-current={i === nav.index ? "page" : undefined}>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{b.title}</span>
                  <span className="muted block text-sm">
                    {weeks(b)}
                    {b.tough ? " · often harder" : ""}
                  </span>
                </span>
                {i === nav.current && <span className="muted shrink-0 font-semibold">now</span>}
              </Link>
            </li>
          ))}
        </ul>
      </Fold>
      <p className="muted text-sm">Ages are typical, not deadlines. The doctor checks development at each visit; the "When to call" page lists the signs that need a call.</p>
    </div>
  );
}
