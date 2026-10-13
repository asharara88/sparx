import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { HomeSummary, Me, RpcError, VaccinesData } from "@/lib/types";
import { can } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { VaccineBook } from "@/components/VaccineBook";

export const dynamic = "force-dynamic";

export default async function VaccinesPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "lana", "view")) redirect("/");
  const { data: sumData } = await supabase.rpc("home_summary");
  const summary = sumData as HomeSummary | RpcError;
  if (!summary.ok) redirect("/");
  const { data } = await supabase.rpc("vaccines_list", { p_subject_id: summary.subject.id });
  const vax = data as VaccinesData | RpcError;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/lana" title={`${summary.subject.name} · Vaccines`} subtitle="The UAE schedule, dated from her birthday. The clinic's card is the final word." />
      {vax.ok ? (
        <VaccineBook subjectId={summary.subject.id} data={vax} timezone={me.household.timezone} canAdd={can(me, "lana", "add")} canEdit={can(me, "lana", "edit")} />
      ) : (
        <p className="card">{"message" in vax ? vax.message : "Could not load."}</p>
      )}
    </div>
  );
}
