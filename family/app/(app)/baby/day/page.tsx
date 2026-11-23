import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { EntryRow, HomeSummary, Me, MilkData, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { child, possessive, pronouns } from "@/lib/names";
import { todayYmd } from "@/lib/time";
import { ageDays, ageWords } from "@/lib/norms";
import { napPattern } from "@/lib/child-insights";
import { nightWindow } from "@/lib/night";
import { bandOf, dayFacts, dayOffer, loggedDays, readDay, suggestDay } from "@/lib/day";
import { meOnce } from "@/lib/server/me";
import { PageHeader } from "@/components/PageHeader";
import { DayForm } from "@/components/DayForm";

export const dynamic = "force-dynamic";

const ABOUT = "/baby?tab=about";

/**
 * "{Name}'s day" (docs/AGES.md): from 12 months a parent says what age and the log
 * cannot: milk on a clock, as a drink or not logged; naps; diapers; bedtime and morning;
 * whether milk is stored. Home's rows, the strip, the child's totals, the tab bar and the +
 * menu follow the answers (lib/day.ts). Reached from About the child, from Home's line at
 * 12, 18, 24 and 36 months (?offer=1) and once after sign-up (?first=1).
 *
 * The answers come filled in (suggestDay): a saved day as it is, else from the last week
 * where it says something, else by age. A parent's screen: anyone else, a baby's family and
 * an admin viewing as someone else go back to About the child, and the database refuses
 * them too. Built as the log form is (DESIGN.md), with no helper button on it.
 */
export default async function DayPage({ searchParams }: { searchParams: Promise<{ first?: string; offer?: string }> }) {
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me;
  if (!can(me, "lana", "view")) redirect("/");
  if (me.role.id !== "admin" || me.preview) redirect(ABOUT);
  const tz = me.household.timezone;
  const today = todayYmd(tz);
  const now = Date.now();
  const [{ data: sumData }, { data: milkData }] = await Promise.all([supabase.rpc("home_summary"), supabase.rpc("milk_list")]);
  const summary = sumData as HomeSummary | RpcError;
  if (!summary.ok) redirect("/");
  const s = summary.subject;
  // The day opens at 12 months, and an age needs the birth date.
  if (!s.birth_date) redirect(ABOUT);
  const age = ageDays(s.birth_date, today);
  if (bandOf(age) == null) redirect(ABOUT);
  // The week Home reads: what the family logs lately, and the naps it shows.
  const { data: weekData } = await supabase.rpc("care_entries_list", { p_subject_id: s.id, p_from: new Date(now - 7 * 86_400_000).toISOString(), p_to: new Date(now + 3_600_000).toISOString() });
  const week = ((weekData as { entries?: EntryRow[] } | null)?.entries ?? []) as EntryRow[];
  const milk = milkData as MilkData | RpcError | null;
  // In stock: not used, not binned and not past its time, as Home counts it.
  const bottles = milk && milk.ok ? milk.fridge_count + milk.freezer_count : 0;

  const saved = readDay(s.settings, age, s.birth_date);
  // The log's own word on naps: the pattern without the family's answer in it.
  const pattern = napPattern(week, age, now, tz, now - 7 * 86_400_000);
  const facts = dayFacts(summary, { now, today, tz, breastfeeds: !!me.member.breastfeeds, inStock: bottles > 0, week, pattern });

  // The door decides what stands beside Save: "Later" once after sign-up, while no day is
  // saved; "Keep it as it is" from Home's line, while that line is still offered; from About
  // nothing. An address kept from an earlier visit opens as About does.
  const sp = await searchParams;
  const first = sp.first === "1" && !saved;
  const offered = !first && sp.offer === "1" && !!dayOffer({ settings: s.settings, birthDate: s.birth_date, createdAt: s.created_at ?? null, today, tz, name: s.name, their: pronouns(child(me)?.sex ?? null).their });
  const door = first ? "first" : offered ? "offer" : "about";
  // A saved day opened from About is shown as it is. Otherwise the last week may speak, where
  // 3 or more of its days have entries.
  const start = suggestDay(age, facts, pattern, saved, door === "about" && saved ? null : loggedDays(week, today, tz));
  const line = start.from === "log" ? "From the last week. Change what is different." : start.from === "age" ? `A start for ${ageWords(s.birth_date, today)}. Change what is different.` : undefined;
  const night = nightWindow(s.settings);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader back={ABOUT} title={`${possessive(s.name)} day`} subtitle={line} />
      <DayForm subjectId={s.id} start={{ milk: start.milk, naps: start.naps, diapers: start.diapers, stores_milk: start.stores_milk }} nightFrom={night.from} nightTo={night.to} bottles={bottles} door={door} />
    </div>
  );
}
