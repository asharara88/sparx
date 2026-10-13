import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { HomeSummary, Me, MedicinesData, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { Medicines } from "@/components/Medicines";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function MedicinePage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "lana", "view")) redirect("/");
  const { data: sumData } = await supabase.rpc("home_summary");
  const summary = sumData as HomeSummary | RpcError;
  if (!summary.ok) redirect("/lana");
  const { data } = await supabase.rpc("medicines_list", { p_subject_id: summary.subject.id });
  const meds = data as MedicinesData | RpcError | null;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/lana" title="Medicine" subtitle={`What ${summary.subject.name} takes, and how long to wait between doses.`} />
      <Medicines subjectId={summary.subject.id} items={meds && meds.ok ? meds.items : []} timezone={me.household.timezone} />
      <p className="muted text-sm">Every “Given” goes into her log as a medicine entry, so the handover and the doctor summary show it.</p>
    </div>
  );
}
