import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { EntryType, Me, Subject } from "@/lib/types";
import { can } from "@/lib/types";
import { childName, possessive } from "@/lib/names";
import { EntryTypesAdmin } from "@/components/EntryTypesAdmin";
import { PageHeader } from "@/components/PageHeader";
import { meOnce } from "@/lib/server/me";
import { dayFacts, dayPlan, readDay, typesOn } from "@/lib/day";
import { ageDays } from "@/lib/norms";
import { todayYmd } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function EntryTypesPage() {
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me;
  if (!can(me, "members", "edit")) redirect("/members");
  const [{ data }, { data: subject }] = await Promise.all([
    supabase.from("care_entry_types").select("*").eq("module_id", "lana").order("module_id").order("sort"),
    supabase.from("care_subjects").select("*").eq("kind", "child").eq("is_active", true).order("sort").limit(1).maybeSingle(),
  ]);
  const stored = (data as EntryType[] | null) ?? [];
  // A kind that only some homes turn on (Potty, in "{Name}'s day") is listed here only in a
  // home that has: the rows as stored, less that one (lib/day.ts typesOn). They go to the form
  // as they were read, because what the form saves is the shared row every home reads. Only
  // what the day turns on is read from the plan, which rests on nothing in the log.
  const tz = me.household.timezone;
  const today = todayYmd(tz);
  const born = (subject as Subject | null)?.birth_date ?? null;
  const age = born ? ageDays(born, today) : null;
  // A kind switched off is still listed here (to switch it on again), so it counts as there.
  const { on } = dayPlan(readDay((subject as Subject | null)?.settings, age, born), age, dayFacts({ types: stored, last: {} }, { now: Date.now(), today, tz, breastfeeds: !!me.member.breastfeeds, inStock: false, week: [], pattern: { expected: false, napsToday: 0 } }));
  const types = typesOn(stored, on);
  // The rows not listed: a new type must not take the id of one of them.
  const taken = stored.filter((t) => !types.includes(t)).map((t) => t.id);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/members" title="Entry types" subtitle="What the logs can record, and when something is due again." />
      {!me.platform && (
        <p className="notice notice-accent">
          This is shared by every home on elnunu, so only the first home&apos;s admins change it. What you see here is what applies to yours.
        </p>
      )}
      <EntryTypesAdmin
        types={types}
        taken={taken}
        modules={[
          { id: "lana", label: `${possessive(childName(me))} log` },
        ]}
      />
    </div>
  );
}
