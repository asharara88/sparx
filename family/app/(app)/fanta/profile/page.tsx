import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { DueItem, EntryRow, Me, Subject } from "@/lib/types";
import { can } from "@/lib/types";
import { ProfileCard } from "@/components/ProfileCard";
import { Icon } from "@/components/Icon";
import { WeightChart } from "@/components/Trends";
import { addDays, dayRange, todayYmd } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function FantaProfilePage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "fanta", "view")) redirect("/");
  const { data: subject } = await supabase.from("care_subjects").select("*").eq("module_id", "fanta").eq("is_active", true).order("sort").limit(1).single();
  if (!subject) redirect("/");
  const tz = me.household.timezone;
  const today = todayYmd(tz);
  const [{ data: dueData }, { data: wData }] = await Promise.all([
    supabase.rpc("care_due_list", { p_days_ahead: 400 }),
    supabase.rpc("care_entries_list", { p_subject_id: (subject as Subject).id, p_from: dayRange(addDays(today, -365), tz).from, p_to: dayRange(today, tz).to }),
  ]);
  const weights = (((wData as { entries?: EntryRow[] } | null)?.entries ?? []) as EntryRow[])
    .filter((e) => e.type_id === "fanta.weight" && Number(e.payload.weight_kg) > 0)
    .map((e) => ({ day: new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(e.occurred_at)), weight_kg: Number(e.payload.weight_kg) }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const due = (((dueData as { items?: DueItem[] })?.items ?? []) as DueItem[]).filter((d) => d.subject_id === (subject as Subject).id);
  return (
    <div className="flex flex-col gap-4">
      <header className="page-header flex items-center gap-2">
        <Link href="/fanta" className="icon-btn" aria-label="Back">
          <Icon name="back" size={24} />
        </Link>
        <span className="muted flex-1">Profile card</span>
        <Link href="/fanta/export" className="btn">
          <Icon name="printer" size={20} /> For the vet
        </Link>
      </header>
      <ProfileCard subject={subject as Subject} due={due} timezone={me.household.timezone} />
      {weights.length > 0 && (
        <section className="card">
          <h2 className="font-semibold">Weight</h2>
          <p className="muted text-sm">
            {weights[weights.length - 1].weight_kg} kg on {weights[weights.length - 1].day}
            {weights.length > 1 ? `, ${(weights[weights.length - 1].weight_kg - weights[0].weight_kg).toFixed(2)} kg since ${weights[0].day}` : ""}.
          </p>
          <WeightChart points={weights} />
        </section>
      )}
    </div>
  );
}
