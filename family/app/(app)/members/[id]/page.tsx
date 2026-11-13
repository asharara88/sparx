import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AttendanceData, Me, Member, Presence, PresenceState, Role, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { MemberForm, SheetRow } from "@/components/MemberForm";
import { WorkDaysRow } from "@/components/WorkDaysForm";
import { PresenceForm } from "@/components/PresenceForm";
import { PageHeader } from "@/components/PageHeader";
import { InviteLink } from "@/components/InviteLink";
import { AttendanceButton } from "@/components/AttendanceButton";
import { Icon } from "@/components/Icon";
import { fmtDate, fmtTime, todayYmd } from "@/lib/time";
import type { AccountState } from "@/lib/accounts";
import { meOnce } from "@/lib/server/me";

export const dynamic = "force-dynamic";

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me;
  if (!can(me, "members", "edit")) redirect("/");
  const isNew = id === "new";

  const [{ data: roles }, { data: states }, { data: member }, { data: workDays }, { data: presence }, { data: accountsData }, { data: attData }] = await Promise.all([
    supabase.from("roles").select("*").order("sort"),
    supabase.from("presence_states").select("*").order("sort"),
    isNew ? Promise.resolve({ data: null }) : supabase.from("members").select("*").eq("id", id).single(),
    isNew ? Promise.resolve({ data: [] }) : supabase.from("work_schedules").select("weekday").eq("member_id", id),
    isNew ? Promise.resolve({ data: [] }) : supabase.from("presence").select("*").eq("member_id", id).order("starts_on", { ascending: false }).limit(5),
    // Whether they have signed in (migration 5300); refused while previewing, which is read only.
    isNew ? Promise.resolve({ data: null }) : supabase.rpc("members_accounts"),
    isNew ? Promise.resolve({ data: null }) : supabase.rpc("attendance_today"),
  ]);
  if (!isNew && !member) redirect("/members");
  const m = member as Member | null;
  const tz = me.household.timezone;

  if (isNew || !m) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader back="/members" title="Add a member" />
        <MemberForm member={null} roles={roles as Role[]} isSelf={false} />
      </div>
    );
  }

  const self = m.id === me.member.id;
  const name = m.display_name;
  const accountsRes = accountsData as { ok: boolean; members?: Record<string, AccountState> } | null;
  const account = accountsRes?.ok ? accountsRes.members?.[m.id] : undefined;
  const weekdays = ((workDays as { weekday: number }[]) ?? []).map((w) => w.weekday);

  // Who works here and whether they are in today (moved from the Members list: an action on
  // one person lives on their page, and the list says "Here since 06:58").
  const att = attData as AttendanceData | RpcError | null;
  const open = att?.ok ? (att.open.find((o) => o.member_id === m.id) ?? null) : null;
  const leftAt = att?.ok
    ? att.today
        .filter((v) => v.member_id === m.id && v.out_at)
        .map((v) => v.out_at as string)
        .sort()
        .pop()
    : undefined;
  const showAttendance = att?.ok && m.is_active && !self && (weekdays.length > 0 || open);

  // Where they are, as the row says it. A presence date is a calendar day, not an instant,
  // so it is read in UTC: in the home's zone a day west of UTC would show the day before.
  const history = (presence as Presence[]) ?? [];
  const stateList = (states as PresenceState[]) ?? [];
  const today = todayYmd(tz);
  const day = (ymd: string) => (ymd === today ? "today" : fmtDate(ymd, "UTC", ymd.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }));
  // The one in force today (as the Members list says it), else the next one coming; never a
  // stay that has ended (rule 6). History is newest first, so the last future one is the next.
  const nowIn = history.find((p) => p.starts_on <= today && (!p.ends_on || p.ends_on >= today));
  const cur = nowIn ?? history.filter((p) => p.starts_on > today).pop();
  const presenceHint = cur
    ? `${stateList.find((s) => s.id === cur.state_id)?.label ?? cur.state_id} ${nowIn ? "since" : "from"} ${day(cur.starts_on)}${cur.ends_on ? ` until ${day(cur.ends_on)}` : ""}`
    : "Not set";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/members" title={name} />
      {showAttendance && (
        <section className="card flex flex-col gap-3" aria-label="Today">
          <p className="min-w-0 font-semibold">{open ? `Here since ${fmtTime(open.in_at, tz)}` : leftAt ? `Left at ${fmtTime(leftAt, tz)}` : "Not here now"}</p>
          <AttendanceButton small memberId={m.id} name={name} timezone={tz} open={open} />
        </section>
      )}
      <MemberForm member={m} roles={roles as Role[]} isSelf={self}>
        <ul className="card flex flex-col p-0" aria-label="Work and where they are">
          <WorkDaysRow memberId={m.id} initial={weekdays} from={m.work_from ?? ""} to={m.work_to ?? ""} />
          <SheetRow label="Where they are" hint={presenceHint}>
            <PresenceForm bare memberId={m.id} states={stateList} history={history} />
          </SheetRow>
        </ul>
        {!self && !me.preview && (
          <section className="card flex flex-col gap-2" aria-label="Their way in">
            <h2 className="text-lg font-semibold">Their way in</h2>
            <p className="muted">{account === "signed_in" ? `${name} has signed in.` : `Send ${name} a link to join this home.`}</p>
            <InviteLink memberId={m.id} name={name} state={account} />
            {m.is_active && (
              <form action="/api/view-as" method="post">
                <input type="hidden" name="member_id" value={m.id} />
                <button type="submit" className="btn w-full">
                  <Icon name="eye" size={18} /> View the app as {name}
                </button>
              </form>
            )}
          </section>
        )}
      </MemberForm>
    </div>
  );
}
