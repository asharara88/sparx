import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { DueItem, Me, Subject } from "@/lib/types";
import { can } from "@/lib/types";
import { ProfileCard } from "@/components/ProfileCard";

export const dynamic = "force-dynamic";

export default async function FantaProfilePage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "fanta", "view")) redirect("/");
  const { data: subject } = await supabase.from("care_subjects").select("*").eq("module_id", "fanta").eq("is_active", true).order("sort").limit(1).single();
  if (!subject) redirect("/");
  const { data: dueData } = await supabase.rpc("care_due_list", { p_days_ahead: 400 });
  const due = (((dueData as { items?: DueItem[] })?.items ?? []) as DueItem[]).filter((d) => d.subject_id === (subject as Subject).id);
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3 pt-2">
        <Link href="/fanta" className="btn" aria-label="Back">
          ‹
        </Link>
        <span className="muted flex-1">Profile card</span>
        <Link href="/fanta/export" className="btn">
          🖨️ For the vet
        </Link>
      </header>
      <ProfileCard subject={subject as Subject} due={due} timezone={me.household.timezone} />
    </div>
  );
}
