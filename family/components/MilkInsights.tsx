import Link from "next/link";
import type { EntryRow, MilkData } from "@/lib/types";
import { milkForecast, pumpInsights, thawPlan } from "@/lib/milk-insights";
import { fmtDate, fmtTime } from "@/lib/time";
import { Icon } from "@/components/Icon";

/**
 * Milk sense on the Milk page: when the fridge runs out at this pace, how the
 * pumping is going morning versus night and week on week, and tonight's thaw
 * plan. All estimates from the last 7 to 14 days; nothing is written.
 */
export function MilkInsights({ milk, entries, timezone, thaw }: { milk: MilkData; entries: EntryRow[]; timezone: string; thaw: Parameters<typeof thawPlan>[2] }) {
  const safe = milk.bottles.filter((b) => b.location === "fridge" && !b.expired).reduce((s, b) => s + b.amount_ml, 0);
  const f = milkForecast(safe, entries);
  const p = pumpInsights(entries, timezone);
  const soon = f.until != null && f.until - Date.now() < 2 * 86_400_000;
  return (
    <>
      <ThawReminder milk={milk} entries={entries} timezone={timezone} opts={thaw} />
      <section className="card flex flex-col gap-2" aria-labelledby="mf-h">
        <div>
          <h2 id="mf-h" className="font-semibold">
            Milk forecast
          </h2>
          <p className="muted text-sm">An estimate from the last 7 days.</p>
        </div>
        {f.usePerDay === 0 ? (
          <p className="muted text-sm">No bottles logged this week yet.</p>
        ) : (
          <>
            <p className={`notice ${soon ? "notice-warn" : f.until == null ? "notice-ok" : ""} font-semibold`}>
              {f.until != null ? `Fridge milk lasts until about ${fmtDate(new Date(f.until).toISOString(), timezone, { weekday: "short" })} ${fmtTime(new Date(f.until).toISOString(), timezone)}` : "Pumping is keeping up with her bottles."}
            </p>
            <p className="muted text-sm">
              Bottles use about {f.usePerDay} ml a day · pumps add about {f.pumpPerDay} ml a day.
            </p>
            {f.shortPerDay > 0 && (
              <p className="text-sm font-semibold">
                To keep up: pump about {f.shortPerDay} ml more a day
                {milk.freezer_ml > 0 ? `, or thaw about ${Math.max(1, Math.round(f.shortPerDay / 130))} bag a day (${milk.freezer_ml} ml frozen)` : ""}.
              </p>
            )}
          </>
        )}
        {p.count > 0 && (
          <div className="mt-1 flex flex-col gap-1 border-t border-[var(--line)] pt-2">
            <h3 className="font-semibold">Pumping</h3>
            <p className="text-sm">
              {p.morning != null && (
                <>
                  Morning pumps average <b>{p.morning} ml</b>.{" "}
                </>
              )}
              {p.night != null && (
                <>
                  Night pumps average <b>{p.night} ml</b>.
                </>
              )}
            </p>
            <p className="muted text-sm">
              This week {p.lastDay} ml a day
              {p.prevDay ? ` · last week ${p.prevDay} ml` : ""}
              {p.change != null ? ` (${p.change >= 0 ? "+" : ""}${Math.round(p.change * 100)}%)` : ""}
            </p>
            {p.dropping && <p className="notice notice-warn text-sm">Supply is a bit lower than last week. Rest, water and not skipping pumps usually help. If it keeps dropping, a lactation consultant can help.</p>}
          </div>
        )}
      </section>
    </>
  );
}

/** The evening before a workday: which freezer bags to bring down for tomorrow. Quiet otherwise. */
export function ThawReminder({ milk, entries, timezone, opts }: { milk: MilkData; entries: EntryRow[]; timezone: string; opts: Parameters<typeof thawPlan>[2] }) {
  const plan = thawPlan(milk.bottles, entries, opts);
  if (!plan || (plan.picks.length === 0 && !plan.short)) return null;
  return (
    <Link href="/lana/milk" className="notice notice-warn row-link flex items-start gap-3 no-underline">
      <Icon name="droplet" size={22} className="mt-0.5 shrink-0" />
      <span className="min-w-0 grow">
        <span className="block text-xs font-bold uppercase tracking-wide opacity-75">Tonight, for tomorrow</span>
        <span className="block font-semibold">
          {plan.picks.length ? `Move ${plan.picks.map((b) => `the ${b.amount_ml} ml from ${fmtDate(b.pumped_at, timezone, { day: "numeric", month: "short" })}`).join(" and ")} down to the fridge.` : "Not enough milk for tomorrow."}
        </span>
        <span className="block text-sm opacity-90">
          Tomorrow needs about {plan.need} ml · {plan.have} ml safe in the fridge.
          {plan.short ? ` Still short by ${plan.short} ml: pump extra if you can.` : ""}
        </span>
      </span>
    </Link>
  );
}
