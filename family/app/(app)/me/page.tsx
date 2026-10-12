import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Me, Presence, PresenceState } from "@/lib/types";
import { WEEKDAYS, can } from "@/lib/types";
import { PresenceForm } from "@/components/PresenceForm";
import { SignOutButton } from "@/components/SignOutButton";
import { NotificationsToggle } from "@/components/NotificationsToggle";

export const dynamic = "force-dynamic";

export default async function MePage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  const [{ data: states }, { data: history }] = await Promise.all([
    supabase.from("presence_states").select("*").order("sort"),
    supabase.from("presence").select("*").eq("member_id", me.member.id).order("starts_on", { ascending: false }).limit(5),
  ]);
  return (
    <div className="flex flex-col gap-4">
      <header className="page-header page-header-large">
        <h1 className="page-title">{me.member.display_name}</h1>
        <p className="muted">
          {me.role.label} · {me.member.email}
        </p>
      </header>
      {me.work_days.length > 0 && (
        <div className="card">
          <h2 className="text-lg font-semibold">Your work days</h2>
          <p className="mt-1">{me.work_days.map((d) => WEEKDAYS[d]).join(", ")}</p>
          <p className="muted text-sm">Ask Mido or Dana to change these.</p>
        </div>
      )}
      {(can(me, "members", "edit") || can(me, "audit", "view") || can(me, "maintenance", "view") || can(me, "assistant", "view")) && (
        <div className="grid grid-cols-2 gap-3">
          {can(me, "assistant", "view") && (
            <Link href="/ask" className="btn">
              💬 Ask
            </Link>
          )}
          {can(me, "maintenance", "view") && (
            <Link href="/house" className="btn">
              🏠 The house
            </Link>
          )}
          {can(me, "fanta", "view") && (
            <Link href="/fanta" className="btn">
              🐈 Fanta
            </Link>
          )}
          {can(me, "members", "edit") && (
            <Link href="/members" className="btn">
              👪 Members
            </Link>
          )}
          {can(me, "audit", "view") && (
            <Link href="/audit" className="btn">
              📋 Audit log
            </Link>
          )}
        </div>
      )}
      <NotificationsToggle />
      <PresenceForm memberId={me.member.id} states={(states as PresenceState[]) ?? []} history={(history as Presence[]) ?? []} title="Where are you?" />
      <div className="card">
        <h2 className="text-lg font-semibold">Add this app to your phone</h2>
        <p className="mt-1">iPhone: in Safari tap Share, then “Add to Home Screen”.</p>
        <p>Android: in Chrome tap the menu (⋮), then “Install app” or “Add to Home screen”.</p>
      </div>
      <Link href="/me/password" className="btn">
        Change password
      </Link>
      <SignOutButton />
    </div>
  );
}
