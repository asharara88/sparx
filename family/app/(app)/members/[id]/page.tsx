import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Me, Member, Presence, PresenceState, Role } from "@/lib/types";
import { can } from "@/lib/types";
import { MemberForm } from "@/components/MemberForm";
import { WorkDaysForm } from "@/components/WorkDaysForm";
import { PresenceForm } from "@/components/PresenceForm";
import { PageHeader } from "@/components/PageHeader";
import { InviteLink } from "@/components/InviteLink";
import { meOnce } from "@/lib/server/me";

export const dynamic = "force-dynamic";

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: meData } = await meOnce();
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
      {!isNew && m!.id !== me.member.id && !me.preview && (
        <div className="card flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Their way in</h2>
          <p className="muted">Send {m!.display_name} their invite link: they sign in with any e-mail and land here as themselves.</p>
          <InviteLink memberId={m!.id} name={m!.display_name} state={undefined} />
        </div>
      )}
      {!isNew && (
        <>
          <WorkDaysForm memberId={m!.id} initial={((workDays as { weekday: number }[]) ?? []).map((w) => w.weekday)} from={m!.work_from ?? ""} to={m!.work_to ?? ""} />
          <PresenceForm memberId={m!.id} states={states as PresenceState[]} history={(presence as Presence[]) ?? []} />
        </>
      )}
    </div>
  );
}
