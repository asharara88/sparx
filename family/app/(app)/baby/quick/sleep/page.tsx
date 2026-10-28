import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { HomeSummary, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { QuickSleep } from "@/components/QuickSleep";
import { PageHeader } from "@/components/PageHeader";
import { meOnce } from "@/lib/server/me";

export const dynamic = "force-dynamic";

/** Opened from the home-screen shortcut: start or end the child's sleep in one tap. */
export default async function QuickSleepPage() {
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me;
  if (!can(me, "lana", "add")) redirect("/");
  const { data: sumData } = await supabase.rpc("home_summary");
  const summary = sumData as HomeSummary | RpcError;
  if (!summary.ok) redirect("/");
  const sleepType = summary.types.find((t) => t.key === "sleep");
  if (!sleepType) redirect("/baby");
  const asleep = summary.ongoing.find((e) => e.type_id === sleepType.id) ?? null;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/" title="Sleep" subtitle={asleep ? `${summary.subject.name} is asleep.` : `${summary.subject.name} is awake.`} />
      <QuickSleep subjectId={summary.subject.id} typeId={sleepType.id} asleep={asleep} timezone={me.household.timezone} />
      <div className="grid grid-cols-2 gap-2">
        <Link href="/baby/quick/feed" className="btn">
          Feed
        </Link>
        <Link href="/baby/log/diaper" className="btn">
          Diaper
        </Link>
      </div>
      <p className="muted text-sm">Add this to your home screen for one-tap timers: iPhone Share → Add to Home Screen; Android menu → Add to Home screen. Long-press the app icon for the shortcuts.</p>
    </div>
  );
}
