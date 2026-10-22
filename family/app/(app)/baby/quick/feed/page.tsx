import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { HomeSummary, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { fmtTime } from "@/lib/time";
import { QuickFeed } from "@/components/QuickFeed";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

type Side = "Left" | "Right";
const sideOf = (p: Record<string, unknown>): Side | null =>
  p.method === "Breast" && (p.side === "Left" || p.side === "Right")
    ? p.side
    : null;

/** Opened from the home-screen shortcut: start, switch or finish a breastfeed in one tap. */
export default async function QuickFeedPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "lana", "add")) redirect("/");
  const { data: sumData } = await supabase.rpc("home_summary");
  const summary = sumData as HomeSummary | RpcError;
  if (!summary.ok) redirect("/");
  const feedType = summary.types.find((t) => t.key === "feed");
  if (!feedType) redirect("/baby");
  // The boobs are for the member who breastfeeds; everyone else lands on the feed form.
  const flag = feedType.settings?.timer_flag;
  if (!flag || !(me.member as unknown as Record<string, unknown>)[flag])
    redirect("/baby/log/feed");
  const tz = me.household.timezone;
  const ongoing = summary.ongoing.filter((e) => e.type_id === feedType.id);
  const open = ongoing[0] ?? null;
  const last = summary.last[feedType.id] ?? null;
  const lastSide = last ? sideOf(last.payload) : null;
  const counts = { Left: 0, Right: 0 };
  for (const e of summary.today_entries) {
    if (e.type_id !== feedType.id) continue;
    const s = sideOf(e.payload);
    if (s) counts[s] += 1;
  }
  const line = open
    ? `feeding${sideOf(open.payload) ? `, ${sideOf(open.payload)!.toLowerCase()} side,` : ""} since ${fmtTime(open.occurred_at, tz)}.`
    : last
      ? `last fed ${fmtTime(last.occurred_at, tz)}${lastSide ? `, ${lastSide.toLowerCase()} side` : ""}.`
      : "tap a side to start.";
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back="/"
        title="Feed"
        subtitle={`${summary.subject.name}: ${line}`}
      />
      <QuickFeed
        subjectId={summary.subject.id}
        typeId={feedType.id}
        types={summary.types}
        ongoing={ongoing}
        lastSide={lastSide}
        counts={counts}
        timezone={tz}
      />
      <div className="grid grid-cols-2 gap-2">
        <Link href="/baby/quick/sleep" className="btn">
          Sleep
        </Link>
        <Link href="/baby/log/diaper" className="btn">
          Diaper
        </Link>
      </div>
      <p className="muted text-sm">
        A bottle, or a feed that started earlier:{" "}
        <Link href="/baby" className="underline">
          {summary.subject.name}&apos;s screen
        </Link>
        .
      </p>
    </div>
  );
}
