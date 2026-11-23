import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { EntryType, Me, Subject } from "@/lib/types";
import { can } from "@/lib/types";
import { EntryForm } from "@/components/EntryForm";
import { meOnce } from "@/lib/server/me";
import { dayFacts, dayPlan, readDay, typesForDay } from "@/lib/day";
import { ageDays } from "@/lib/norms";
import { todayYmd } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function LogPage({ params, searchParams }: { params: Promise<{ type: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { type } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me;
  if (!can(me, "lana", "add")) redirect("/");

  const [{ data: subject }, { data: typeRows }] = await Promise.all([
    supabase.from("care_subjects").select("*").eq("kind", "child").eq("is_active", true).order("sort").limit(1).single(),
    supabase.from("care_entry_types").select("*").eq("module_id", "lana").eq("is_active", true).order("sort"),
  ]);
  const stored = (typeRows as EntryType[] | null) ?? [];
  if (!subject || !stored.some((t) => t.key === type)) redirect("/");

  // The form follows the child's day (lib/day.ts), as the + menu does: a kind the home has not
  // turned on is not offered by its address either. Only what the day itself says and turns on
  // is read for this, and with no day the rows are the stored ones whatever the log holds: so
  // nothing of the log is fetched, and those facts are left empty.
  const tz = me.household.timezone;
  const today = todayYmd(tz);
  const born = (subject as Subject).birth_date;
  const age = born ? ageDays(born, today) : null;
  const plan = dayPlan(readDay((subject as Subject).settings, age, born), age, dayFacts({ types: stored, last: {} }, { now: Date.now(), today, tz, breastfeeds: !!me.member.breastfeeds, inStock: false, week: [], pattern: { expected: false, napsToday: 0 } }));
  const entryType = typesForDay(stored, { saved: plan.saved, milk: plan.milk, storesMilk: plan.storesMilk, on: plan.on }).find((t) => t.key === type);
  if (!entryType) redirect("/baby");

  // A choice asked for in the link (?method=Bottle from the Feeds section's "Log a bottle"):
  // only a choice field of this type and one of its own options.
  const preset: Record<string, string> = {};
  for (const f of entryType.fields) {
    const v = sp[f.key];
    if (f.type === "choice" && typeof v === "string" && (f.options ?? []).includes(v)) preset[f.key] = v;
  }
  // Pre-fill from the most recent entry of this type (e.g. same bottle size), of the asked-for choice when there is one.
  let q = supabase
    .from("care_entries")
    .select("payload")
    .eq("subject_id", (subject as Subject).id)
    .eq("type_id", entryType.id)
    .is("deleted_at", null);
  for (const [k, v] of Object.entries(preset)) q = q.eq(`payload->>${k}`, v);
  const { data: lastRows } = await q.order("occurred_at", { ascending: false }).limit(1);
  const lastPayload = { ...(((lastRows?.[0] as { payload?: Record<string, unknown> } | undefined)?.payload ?? {}) as Record<string, unknown>), ...preset };

  return (
    <EntryForm
      mode="create"
      subject={subject as Subject}
      entryType={entryType}
      timezone={tz}
      initial={{ payload: lastPayload, occurred_at: new Date().toISOString(), ended_at: null, note: "" }}
    />
  );
}
