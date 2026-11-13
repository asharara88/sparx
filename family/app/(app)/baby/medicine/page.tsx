import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { HomeSummary, Me, MedicinesData, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { Medicines } from "@/components/Medicines";
import { PageHeader } from "@/components/PageHeader";
import { meOnce } from "@/lib/server/me";

export const dynamic = "force-dynamic";

export default async function MedicinePage() {
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me;
  if (!can(me, "lana", "view")) redirect("/");
  const { data: sumData } = await supabase.rpc("home_summary");
  const summary = sumData as HomeSummary | RpcError;
  if (!summary.ok) redirect("/baby");
  const { data } = await supabase.rpc("medicines_list", { p_subject_id: summary.subject.id });
  const meds = data as MedicinesData | RpcError | null;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/baby?tab=about" title="Medicine" subtitle={`What ${summary.subject.name} takes. The app checks only the hours between doses.`} />
      <Medicines subjectId={summary.subject.id} items={meds && meds.ok ? meds.items : []} timezone={me.household.timezone} />
    </div>
  );
}
