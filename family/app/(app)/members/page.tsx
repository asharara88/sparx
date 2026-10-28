import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { HouseholdToday, Me, Role } from "@/lib/types";
import { WEEKDAYS, can } from "@/lib/types";
import { Icon } from "@/components/Icon";
import { Avatar } from "@/components/Avatar";
import { InviteLink } from "@/components/InviteLink";
import { accountLabel, type AccountState } from "@/lib/accounts";

export const dynamic = "force-dynamic";

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "members", "edit")) redirect("/");
  const { error } = await searchParams;
  const [{ data: hh }, { data: roles }, { data: inactive }, { data: photoRows }, { data: accountsData }] = await Promise.all([
    supabase.rpc("household_today"),
    supabase.from("roles").select("*").order("sort"),
    supabase.from("members").select("id, display_name, role_id").eq("is_active", false),
    supabase.from("members").select("id, photo_path").eq("is_active", true),
    supabase.rpc("members_accounts"),
  ]);
  const photos = new Map(((photoRows as { id: string; photo_path: string | null }[] | null) ?? []).map((r) => [r.id, r.photo_path]));
  // Who has signed in, who still waits for a link (migration 5300); not while previewing, which is read only.
  const accountsRes = accountsData as { ok: boolean; members?: Record<string, AccountState> } | null;
  const accounts = accountsRes?.ok ? (accountsRes.members ?? {}) : null;
  const data = hh as HouseholdToday;
  const roleLabel = new Map((roles as Role[]).map((r) => [r.id, r.label]));

  return (
    <div className="flex flex-col gap-4">
      <header className="page-header page-header-large flex items-center justify-between">
        <h1 className="page-title">Members</h1>
        <Link href="/members/new" className="btn btn-primary">
          <Icon name="plus" size={18} /> Add
        </Link>
      </header>
      {error === "preview" && <p className="notice notice-danger">“View as” is not set up on the server yet (SUPABASE_JWT_SECRET).</p>}
      {error === "member" && <p className="notice notice-danger">That member is not active.</p>}
      <p className="muted text-sm">Add someone, then send them their invite link.</p>
      <ul className="flex flex-col gap-2">
        {data.members.map((m) => (
          <li key={m.id} className="card flex flex-col gap-2">
            <Link href={`/members/${m.id}`} className="flex items-center gap-3">
              <Avatar name={m.name} path={photos.get(m.id)} size={48} />
              <span className="min-w-0 grow">
              <span className="flex items-baseline justify-between">
                <span className="text-lg font-semibold">{m.name}</span>
                <span className="muted">{roleLabel.get(m.role_id) ?? m.role_id}</span>
              </span>
              <p className="muted">
                {m.relationship ? `${m.relationship} · ` : ""}
                {m.presence ? m.presence.label : "No presence set"}
                {m.presence?.ends_on ? ` until ${m.presence.ends_on}` : ""}
              </p>
              {m.work_days.length > 0 && <p className="muted">Works: {m.work_days.map((d) => WEEKDAYS[d]).join(", ")}</p>}
              {accounts && m.id !== me.member.id && <p className={accounts[m.id] === "signed_in" ? "muted" : "pill-warn inline-block"}>{accountLabel(accounts[m.id])}</p>}
              </span>
            </Link>
            {accounts && m.id !== me.member.id && <InviteLink memberId={m.id} name={m.name} state={accounts[m.id]} />}
            {m.id !== me.member.id && (
              <form action="/api/view-as" method="post">
                <input type="hidden" name="member_id" value={m.id} />
                <button type="submit" className="btn w-full" style={{ minHeight: 44 }}>
                  <Icon name="eye" size={18} /> View the app as {m.name}
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {(inactive as { id: string; display_name: string }[] | null)?.length ? (
        <p className="muted">
          Inactive: {(inactive as { id: string; display_name: string }[]).map((m) => <Link key={m.id} href={`/members/${m.id}`} className="underline">{m.display_name}</Link>).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, ", ", el] : [el]), [])}
        </p>
      ) : null}
      <nav aria-label="Home settings" className="card flex flex-col p-0">
        {(
          [
            { href: "/members/home", icon: "house", label: "Home settings", hint: me.household.name },
            { href: "/members/roles", icon: "lock", label: "Roles and permissions", hint: null },
            { href: "/members/types", icon: "list", label: "Entry types", hint: null },
          ] as const
        ).map((r) => (
          <Link key={r.href} href={r.href} className="row row-link px-4">
            <Icon name={r.icon} size={20} className="shrink-0 text-[var(--accent)]" />
            <span className="flex-1 font-semibold">{r.label}</span>
            {r.hint && <span className="muted truncate text-sm">{r.hint}</span>}
            <Icon name="forward" size={18} className="muted" />
          </Link>
        ))}
      </nav>
    </div>
  );
}
