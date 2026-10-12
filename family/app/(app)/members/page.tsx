import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { HouseholdToday, Me, Role } from "@/lib/types";
import { WEEKDAYS, can } from "@/lib/types";
import { HouseholdForm } from "@/components/HouseholdForm";

export const dynamic = "force-dynamic";

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "members", "edit")) redirect("/");
  const { error } = await searchParams;
  const [{ data: hh }, { data: roles }, { data: inactive }] = await Promise.all([
    supabase.rpc("household_today"),
    supabase.from("roles").select("*").order("sort"),
    supabase.from("members").select("id, display_name, role_id").eq("is_active", false),
  ]);
  const data = hh as HouseholdToday;
  const roleLabel = new Map((roles as Role[]).map((r) => [r.id, r.label]));

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between pt-2">
        <h1 className="text-2xl font-bold">Members</h1>
        <Link href="/members/new" className="btn btn-primary">
          + Add
        </Link>
      </header>
      {error === "preview" && <p className="rounded-xl border-2 border-red-700 p-3 text-red-800">“View as” is not set up on the server yet (SUPABASE_JWT_SECRET).</p>}
      {error === "member" && <p className="rounded-xl border-2 border-red-700 p-3 text-red-800">That member is not active.</p>}
      <ul className="flex flex-col gap-2">
        {data.members.map((m) => (
          <li key={m.id} className="card flex flex-col gap-2">
            <Link href={`/members/${m.id}`} className="block">
              <div className="flex items-baseline justify-between">
                <span className="text-lg font-semibold">{m.name}</span>
                <span className="muted">{roleLabel.get(m.role_id) ?? m.role_id}</span>
              </div>
              <p className="muted">
                {m.relationship ? `${m.relationship} · ` : ""}
                {m.presence ? m.presence.label : "No presence set"}
                {m.presence?.ends_on ? ` until ${m.presence.ends_on}` : ""}
              </p>
              {m.work_days.length > 0 && <p className="muted">Works: {m.work_days.map((d) => WEEKDAYS[d]).join(", ")}</p>}
            </Link>
            {m.id !== me.member.id && (
              <form action="/api/view-as" method="post">
                <input type="hidden" name="member_id" value={m.id} />
                <button type="submit" className="btn w-full" style={{ minHeight: 44 }}>
                  👀 View the app as {m.name}
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
      <Link href="/members/roles" className="btn">
        Roles and permissions
      </Link>
      <HouseholdForm household={me.household} />
    </div>
  );
}
