import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { HomeSummary, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { childPronouns } from "@/lib/names";
import { EmergencyCard } from "@/components/EmergencyCard";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function EmergencyPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "lana", "view")) redirect("/");
  const { data: sumData } = await supabase.rpc("home_summary");
  const summary = sumData as HomeSummary | RpcError;
  if (!summary.ok) redirect("/");
  const lang = (me.member.lang ?? "en") as "en" | "ar" | "ru";
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/" title="Emergency" subtitle={`Ambulance, ${childPronouns(me).their} doctor, hospital and medical details.`} />
      <EmergencyCard subject={summary.subject} lang={lang} canEdit={can(me, "lana", "edit")} />
    </div>
  );
}
