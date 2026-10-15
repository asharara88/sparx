import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { HomeSummary, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { todayYmd } from "@/lib/time";
import { currentMonth } from "@/lib/story";

export const dynamic = "force-dynamic";

/** The story index opens on the latest finished month, or the first month while it runs. */
export default async function StoryIndex() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "lana", "view")) redirect("/");
  const { data: sumData } = await supabase.rpc("home_summary");
  const summary = sumData as HomeSummary | RpcError;
  if (!summary.ok || !summary.subject.birth_date) redirect("/lana");
  const m = currentMonth(summary.subject.birth_date, todayYmd(me.household.timezone));
  redirect(`/lana/story/${Math.max(1, m - 1)}`);
}
