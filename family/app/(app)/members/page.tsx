import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AttendanceData, HouseholdToday, Me, RpcError, Role } from "@/lib/types";
import { fmtDate, fmtTime } from "@/lib/time";
import { can } from "@/lib/types";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { Avatar } from "@/components/Avatar";
import { accountLabel, type AccountState } from "@/lib/accounts";
import { meOnce } from "@/lib/server/me";

export const dynamic = "force-dynamic";

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me;
  if (!can(me, "members", "edit")) redirect("/");
  const { error } = await searchParams;
  const [{ data: hh }, { data: roles }, { data: inactive }, { data: photoRows }, { data: accountsData }, { data: attData }] = await Promise.all([
    supabase.rpc("household_today"),
    supabase.from("roles").select("*").order("sort"),
    supabase.from("members").select("id, display_name, role_id").eq("is_active", false),
    supabase.from("members").select("id, photo_path").eq("is_active", true),
    supabase.rpc("members_accounts"),
    supabase.rpc("attendance_today"),
  ]);
  // Who is in right now (moved from Home, which keeps only "now"): said on their row. Marking
  // someone in or out is on their own page, with the invite and "View the app as".
  const attendance = attData as AttendanceData | RpcError | null;
  const openFor = new Map((attendance?.ok ? attendance.open : []).map((o) => [o.member_id, o]));
  const photos = new Map(((photoRows as { id: string; photo_path: string | null }[] | null) ?? []).map((r) => [r.id, r.photo_path]));
  // Who has signed in, who still waits for a link (migration 5300); not while previewing, which is read only.
  const accountsRes = accountsData as { ok: boolean; members?: Record<string, AccountState> } | null;
  const accounts = accountsRes?.ok ? (accountsRes.members ?? {}) : null;
  const data = hh as HouseholdToday;
  const roleLabel = new Map((roles as Role[]).map((r) => [r.id, r.label]));
  const tz = me.household.timezone;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/me" title="Members" />
      {error === "preview" && <p className="notice notice-danger">“View as” is not set up on the server yet (SUPABASE_JWT_SECRET).</p>}
      {error === "member" && <p className="notice notice-danger">That member is not active.</p>}
      {/* One white list of people (DESIGN.md, "The patterns we use"): a row opens the person,
          where their invite, "View the app as" and in / out live. */}
      <ul className="card flex flex-col p-0" aria-label="Members">
        {data.members.map((m) => {
          const open = openFor.get(m.id);
          // A presence date is a calendar day: read in UTC, or a home west of UTC sees the day before.
          const where = m.presence ? `${m.presence.label}${m.presence.ends_on ? ` until ${fmtDate(m.presence.ends_on, "UTC")}` : ""}` : "No presence set";
          const state = accounts && m.id !== me.member.id ? accounts[m.id] : "signed_in";
          return (
            <li key={m.id} className="row p-0">
              <Link prefetch={false} href={`/members/${m.id}`} className="row-link flex w-full min-w-0 items-center gap-3 px-4 py-3">
                <Avatar name={m.name} path={photos.get(m.id)} size={40} className="shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2">
                    <span className="truncate font-semibold">{m.name}</span>
                    {state !== "signed_in" && <span className="pill pill-warn shrink-0">{accountLabel(state)}</span>}
                  </span>
                  {/* Where they are first: at 320 px the line is cut, and it is the part that changes. */}
                  <span className="muted block truncate text-sm">
                    {open ? `Here since ${fmtTime(open.in_at, tz)}` : where} · {roleLabel.get(m.role_id) ?? m.role_id}
                  </span>
                </span>
                <Icon name="forward" size={18} className="muted shrink-0" />
              </Link>
            </li>
          );
        })}
      </ul>
      {(inactive as { id: string; display_name: string }[] | null)?.length ? (
        <p className="muted">
          Inactive: {(inactive as { id: string; display_name: string }[]).map((m) => <Link prefetch={false} key={m.id} href={`/members/${m.id}`} className="underline">{m.display_name}</Link>).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, ", ", el] : [el]), [])}
        </p>
      ) : null}
      {/* Entry types (/members/types) is a builder's screen, raw field lists: off this list since
          9 November (Dana found it). The page still works for whoever goes to it on purpose. */}
      <nav aria-label="Home settings" className="card flex flex-col p-0">
        {(
          [
            { href: "/members/home", icon: "house", label: "Home settings" },
            { href: "/members/roles", icon: "lock", label: "Roles and permissions" },
          ] as const
        ).map((r) => (
          <Link prefetch={false} key={r.href} href={r.href} className="row row-link px-4">
            <Icon name={r.icon} size={20} className="shrink-0 text-[var(--accent)]" />
            <span className="min-w-0 flex-1 truncate font-medium">{r.label}</span>
            <Icon name="forward" size={18} className="muted shrink-0" />
          </Link>
        ))}
      </nav>
      {/* The screen's main action at the thumb (DESIGN.md), not beside the title. */}
      <div className="bottom-action">
        <Link prefetch={false} href="/members/new" className="btn btn-primary btn-lg w-full">
          <Icon name="plus" size={20} /> Add someone
        </Link>
      </div>
    </div>
  );
}
