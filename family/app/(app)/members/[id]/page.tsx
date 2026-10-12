import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Me, Member, Presence, PresenceState, Role } from "@/lib/types";
import { can } from "@/lib/types";
import { MemberForm } from "@/components/MemberForm";
import { WorkDaysForm } from "@/components/WorkDaysForm";
import { PresenceForm } from "@/components/PresenceForm";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "members", "edit")) redirect("/");
  const isNew = id === "new";

  const [{ data: roles }, { data: states }, { data: member }, { data: workDays }, { data: presence }] = await Promise.all([
    supabase.from("roles").select("*").order("sort"),
    supabase.from("presence_states").select("*").order("sort"),
    isNew ? Promise.resolve({ data: null }) : supabase.from("members").select("*").eq("id", id).single(),
    isNew ? Promise.resolve({ data: [] }) : supabase.from("work_schedules").select("weekday").eq("member_id", id),
    isNew ? Promise.resolve({ data: [] }) : supabase.from("presence").select("*").eq("member_id", id).order("starts_on", { ascending: false }).limit(5),
  ]);
  if (!isNew && !member) redirect("/members");
  const m = member as Member | null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/members" title={<>{isNew ? "Add a member" : m!.display_name}</>} />
      <MemberForm member={m} roles={roles as Role[]} isSelf={m?.id === me.member.id} />
      {!isNew && (
        <>
          <WorkDaysForm memberId={m!.id} initial={((workDays as { weekday: number }[]) ?? []).map((w) => w.weekday)} />
          <PresenceForm memberId={m!.id} states={states as PresenceState[]} history={(presence as Presence[]) ?? []} />
        </>
      )}
    </div>
  );
}
