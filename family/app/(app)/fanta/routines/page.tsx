import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { EntryType, Me, RoutinesData, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { RoutineForm } from "@/components/RoutineForm";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function FantaRoutinesPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "members", "edit") || !can(me, "fanta", "view")) redirect("/fanta");
  const { data: subj } = await supabase.from("care_subjects").select("id").eq("module_id", "fanta").eq("is_active", true).order("sort").limit(1).single();
  if (!subj) redirect("/fanta");
  const subjectId = (subj as { id: string }).id;
  const [{ data: rData }, { data: tData }] = await Promise.all([
    supabase.rpc("routines_list", { p_subject_id: subjectId }),
    supabase.from("care_entry_types").select("*").eq("module_id", "fanta").eq("is_active", true).order("sort"),
  ]);
  const routines = rData as RoutinesData | RpcError;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/fanta" title="Fanta's routines" subtitle="Things that come round every few days." />
      <RoutineForm subjectId={subjectId} routines={routines.ok ? routines.routines : []} types={(tData as EntryType[] | null) ?? []} />
    </div>
  );
}
