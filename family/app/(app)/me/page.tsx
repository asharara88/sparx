import { Wordmark } from "@/components/Brand";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { HomeListing, Me, Presence, PresenceState } from "@/lib/types";
import { WEEKDAYS, can } from "@/lib/types";
import { SignOutButton } from "@/components/SignOutButton";
import { Icon, type IconName } from "@/components/Icon";
import { AvatarUpload } from "@/components/AvatarUpload";
import type { Tint } from "@/components/Fold";
import { meOnce } from "@/lib/server/me";

export const dynamic = "force-dynamic";

const LANG_NAME = { en: "English", ar: "العربية", ru: "Русский" } as const;

/**
 * More: you, then one grouped list (the family's screens, the helper, your settings). Each
 * row opens its own page, so nothing here is a form or a paragraph of how-to.
 */
export default async function MePage() {
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me | null;
  if (!me?.ok) redirect("/");
  const [{ data: states }, { data: history }, { data: homesData }] = await Promise.all([
    supabase.from("presence_states").select("*").order("sort"),
    supabase.from("presence").select("*").eq("member_id", me.member.id).order("starts_on", { ascending: false }).limit(1),
    supabase.rpc("my_homes"),
  ]);
  const homes = (homesData as HomeListing[] | null) ?? [];
  const here = ((history as Presence[] | null) ?? [])[0];
  const hereLabel = ((states as PresenceState[] | null) ?? []).find((s) => s.id === here?.state_id)?.label ?? "Not set";

  // One grouped list (DESIGN.md, "What lives where"): the family's screens, the helper, you.
  const groups: { title: string; rows: { href: string; icon: IconName; label: string; tint: Tint; show: boolean }[] }[] = [
    {
      title: "Family",
      rows: [
        { href: "/chat", icon: "chat", label: "Chat", tint: "guide", show: can(me, "chat", "view") },
        { href: "/members", icon: "users", label: "Members", tint: "house", show: can(me, "members", "edit") },
        { href: "/calendar", icon: "calendar", label: "Calendar", tint: "cal", show: can(me, "calendar", "view") },
        { href: "/notes", icon: "note", label: "Notes", tint: "notes", show: can(me, "notes", "view") },
        { href: "/audit", icon: "history", label: "Audit log", tint: "cal", show: can(me, "audit", "view") },
      ],
    },
    {
      title: "The helper",
      rows: [
        { href: "/ask", icon: "sparkles", label: "Ask", tint: "guide", show: can(me, "assistant", "view") },
        { href: "/ask/memory", icon: "note", label: "What it remembers", tint: "guide", show: can(me, "assistant", "view") },
        { href: "/ask/skills", icon: "clipboard", label: "What it can do", tint: "sleep", show: can(me, "assistant", "edit") },
      ],
    },
  ];
  const settings: { href: string; icon: IconName; label: string; hint?: string | null }[] = [
    { href: "/me/display", icon: "globe", label: "Language and display", hint: LANG_NAME[(me.member.lang ?? "en") as keyof typeof LANG_NAME] },
    { href: "/me/notifications", icon: "bell", label: "Notifications" },
    { href: "/me/presence", icon: "house", label: "Where you are", hint: hereLabel },
    ...(!me.preview ? [{ href: "/me/homes", icon: "home" as IconName, label: "Your homes", hint: `${homes.length || 1}` }] : []),
    { href: "/me/install", icon: "plus", label: "Add to your phone" },
    { href: "/me/password", icon: "key", label: "Password" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <header className="page-header page-header-large flex items-center gap-4">
        <AvatarUpload name={me.member.display_name} path={me.member.photo_path} />
        <div className="min-w-0">
          <h1 className="page-title">{me.member.display_name}</h1>
          <p className="muted truncate text-sm">
            {me.role.label}
            {me.work_days.length > 0 ? ` · works ${me.work_days.map((d) => WEEKDAYS[d].slice(0, 3)).join(", ")}` : ""}
          </p>
        </div>
      </header>

      {groups.map((g) =>
        g.rows.some((r) => r.show) ? (
          <section key={g.title} className="flex flex-col gap-2">
            <h2 className="section-title">{g.title}</h2>
            <nav aria-label={g.title} className="card flex flex-col p-0">
              {g.rows
                .filter((r) => r.show)
                .map((r) => (
                  <Link key={r.href} href={r.href} className="row row-link px-4">
                    <span className={`icon-disc tint-${r.tint}`} style={{ width: 36, height: 36 }}>
                      <Icon name={r.icon} size={19} />
                    </span>
                    <span className="flex-1 font-semibold">{r.label}</span>
                    <Icon name="forward" size={18} className="muted" />
                  </Link>
                ))}
            </nav>
          </section>
        ) : null,
      )}

      <h2 className="section-title">You</h2>
      <nav aria-label="Settings" className="card flex flex-col p-0">
        {settings.map((r) => (
          <Link key={r.href} href={r.href} className="row row-link px-4">
            <Icon name={r.icon} size={20} className="shrink-0 text-[var(--accent)]" />
            <span className="flex-1 font-semibold">{r.label}</span>
            {r.hint && <span className="muted truncate text-sm">{r.hint}</span>}
            <Icon name="forward" size={18} className="muted" />
          </Link>
        ))}
      </nav>

      <SignOutButton />
      <p className="muted flex items-center justify-between pt-2 text-xs">
        <Wordmark size={18} arabic />
        <span>{me.member.email}</span>
      </p>
    </div>
  );
}
