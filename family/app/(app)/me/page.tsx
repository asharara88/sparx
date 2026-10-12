import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Me, Presence, PresenceState } from "@/lib/types";
import { WEEKDAYS, can } from "@/lib/types";
import { PresenceForm } from "@/components/PresenceForm";
import { SignOutButton } from "@/components/SignOutButton";
import { NotificationsToggle } from "@/components/NotificationsToggle";
import { Icon, type IconName } from "@/components/Icon";
import { AvatarUpload } from "@/components/AvatarUpload";
import { PrefsForm } from "@/components/PrefsForm";

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
      <header className="page-header page-header-large flex items-center gap-4">
        <AvatarUpload name={me.member.display_name} path={me.member.photo_path} />
        <div className="min-w-0">
          <h1 className="page-title">{me.member.display_name}</h1>
          <p className="muted truncate">
            {me.role.label} · {me.member.email}
          </p>
        </div>
      </header>
      {me.work_days.length > 0 && (
        <div className="card">
          <h2 className="text-lg font-semibold">Your work days</h2>
          <p className="mt-1">{me.work_days.map((d) => WEEKDAYS[d]).join(", ")}</p>
          <p className="muted text-sm">Ask Mido or Dana to change these.</p>
        </div>
      )}
      {(can(me, "members", "edit") || can(me, "audit", "view") || can(me, "maintenance", "view") || can(me, "assistant", "view") || can(me, "fanta", "view") || can(me, "notes", "view")) && (
        <div className="grid grid-cols-2 gap-3">
          {can(me, "assistant", "view") && <Tile href="/ask" icon="chat" label="Ask" />}
          {can(me, "notes", "view") && <Tile href="/notes" icon="note" label="Notes" />}
          {can(me, "lana", "view") && <Tile href="/lana/milk" icon="bottle" label="Milk stash" />}
          {can(me, "maintenance", "view") && <Tile href="/house" icon="house" label="The house" />}
          {can(me, "fanta", "view") && <Tile href="/fanta" icon="cat" label="Fanta" />}
          {can(me, "members", "edit") && <Tile href="/members" icon="users" label="Members" />}
          {can(me, "audit", "view") && <Tile href="/audit" icon="clipboard" label="Audit log" />}
        </div>
      )}
      <PrefsForm lang={me.member.lang ?? "en"} simple={!!me.member.simple_mode} large={me.member.large_text ?? me.role.id !== "admin"} />
      <NotificationsToggle />
      <PresenceForm memberId={me.member.id} states={(states as PresenceState[]) ?? []} history={(history as Presence[]) ?? []} title="Where are you?" />
      <div className="card">
        <h2 className="text-lg font-semibold">Add this app to your phone</h2>
        <p className="mt-1">iPhone: in Safari tap Share, then “Add to Home Screen”.</p>
        <p>Android: in Chrome tap the menu (⋮), then “Install app” or “Add to Home screen”.</p>
      </div>
      <div className="card flex flex-col gap-2">
        <Link href="/me/password" className="btn">
          <Icon name="key" size={18} /> Change password
        </Link>
        <SignOutButton />
      </div>
    </div>
  );
}

function Tile({ href, icon, label }: { href: string; icon: IconName; label: string }) {
  return (
    <Link href={href} className="tile">
      <span className="tile-icon">
        <Icon name={icon} size={20} />
      </span>
      <span className="font-semibold">{label}</span>
    </Link>
  );
}
