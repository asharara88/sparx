import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Me } from "@/lib/types";
import { can } from "@/lib/types";
import { meOnce } from "@/lib/server/me";
import { PageHeader } from "@/components/PageHeader";
import { Medal } from "@/components/Medal";
import { nextUp, TRACKS, type BadgeNumbers } from "@/lib/achievements";
import { fmtDate } from "@/lib/time";

export const dynamic = "force-dynamic";

interface Earned {
  id: string;
  badge: string;
  tier: number;
  member_name: string | null;
  earned_at: string;
}

/**
 * The trophy shelf (Mido, 9 November): one card per kind of badge, every medal in a row
 * (won ones in their metal, the rest a grey outline to aim for), and what the next one
 * needs. Badges reward what the family does, never the baby's own numbers.
 */
export default async function AchievementsPage() {
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me;
  if (!can(me, "lana", "view")) redirect("/me");
  // Award anything already earned first, so the shelf is never behind the log.
  await supabase.rpc("achievements_check");
  const { data } = await supabase.rpc("achievements_list");
  const res = data as { ok: boolean; earned?: Earned[]; numbers?: BadgeNumbers; pumpers?: string[] } | null;
  const earned = res?.earned ?? [];
  const n = res?.numbers;
  const tz = me.household.timezone;
  const pumper = res?.pumpers?.length === 1 ? res.pumpers[0] : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/me" title="Achievements" subtitle="For the grown-ups: goals met, goals beaten, milk saved." />
      {TRACKS.map((t) => {
        const won = earned.filter((e) => e.badge === t.id);
        const tiers = won.map((e) => e.tier);
        const next = n ? nextUp(t.id, n, tiers) : null;
        const latest = won[0];
        const tint = t.family ? "tint-diaper" : "tint-pump";
        return (
          <section key={t.id} className={`card ${tint} flex flex-col gap-3`} aria-labelledby={`h-${t.id}`}>
            <div className="flex items-baseline justify-between gap-2">
              <h2 id={`h-${t.id}`} className="section-title">
                {t.family ? t.title : pumper ? `${pumper} · ${t.title}` : t.title}
              </h2>
              <span className="text-sm font-semibold tabular-nums">
                {tiers.length} of {t.tiers.length}
              </span>
            </div>
            <ul className="grid grid-cols-5 items-end gap-1" aria-label="Medals">
              {t.tiers.map((x) => {
                const w = won.find((e) => e.tier === x.tier);
                return (
                  <li key={x.tier} className="flex min-w-0 flex-col items-center gap-1 text-center">
                    <Medal metal={x.metal} icon={t.icon} size={46} locked={!w} label={`${x.name}${w ? ", won" : ", not yet"}`} />
                    <span className={`text-[0.82rem] leading-tight ${w ? "font-semibold" : "muted"}`}>{x.name}</span>
                  </li>
                );
              })}
            </ul>
            {next ? (
              <div className="flex flex-col gap-1">
                <p className="text-sm">
                  Next: <b>{next.tier.name}</b> · {t.id === "pump_goal" ? t.unit(next.left) : t.id === "pump_beat" ? t.unit(next.left) : `${t.unit(next.left)} more in the freezer`}
                </p>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--card)]" aria-hidden="true">
                  <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.min(100, Math.round((next.have / next.tier.need) * 100))}%` }} />
                </div>
              </div>
            ) : (
              <p className="text-sm font-semibold">Every medal won.</p>
            )}
            {latest && (
              <p className="muted text-sm">
                Latest: {t.tiers.find((x) => x.tier === latest.tier)?.name}
                {latest.member_name ? ` · ${latest.member_name}` : ""} · {fmtDate(latest.earned_at, tz, { day: "numeric", month: "short" })}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
