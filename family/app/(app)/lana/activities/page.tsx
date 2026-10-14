import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ActivitiesData, HomeSummary, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { ageLabel } from "@/lib/norms";
import { Activities } from "@/components/Activities";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function ActivitiesPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "lana", "view")) redirect("/");
  const { data: sumData } = await supabase.rpc("home_summary");
  const summary = sumData as HomeSummary | RpcError;
  if (!summary.ok) redirect("/lana");
  const { data } = await supabase.rpc("activities_list", { p_subject_id: summary.subject.id });
  const acts = data as ActivitiesData | RpcError | null;
  const items = acts && acts.ok ? acts.items : [];
  const age = acts && acts.ok && acts.age_days != null ? `${ageLabel(acts.age_days)} old` : "";
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/lana" title="Play" subtitle={`Short things to do with ${summary.subject.name}${age ? `, ${age}` : ""}. A few a week is plenty.`} />
      <Activities subjectId={summary.subject.id} items={items} />
    </div>
  );
}
