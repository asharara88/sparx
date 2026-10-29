import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { BagItem, HomeSummary, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { HandoverPanel } from "@/components/HandoverPanel";
import { PageHeader } from "@/components/PageHeader";
import { meOnce } from "@/lib/server/me";

export const dynamic = "force-dynamic";

/** Handing the child over: who has them, what goes in the bag. Opened from About her and Home. */
export default async function HandoverPage() {
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me;
  if (!can(me, "lana", "view")) redirect("/");
  const [{ data: sumData }, { data: bagData }] = await Promise.all([supabase.rpc("home_summary"), supabase.from("bag_items").select("*").order("sort")]);
  const summary = sumData as HomeSummary | RpcError;
  if (!summary.ok) redirect("/");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/baby?tab=about" title="Handover" />
      <HandoverPanel summary={summary} bag={((bagData as BagItem[] | null) ?? []) as BagItem[]} />
    </div>
  );
}
