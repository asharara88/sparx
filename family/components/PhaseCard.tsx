import { ageOutlook } from "@/lib/lana-insights";

/** What her age usually brings now, and what comes next. */
export function PhaseCard({ ageDays, name }: { ageDays: number; name: string }) {
  const o = ageOutlook(ageDays);
  return (
    <section className="card" aria-labelledby="phase-h">
      <h2 id="phase-h" className="font-semibold">
        What to expect at {o.ageMonths} months
      </h2>
      {o.now.length > 0 ? (
        <ul className="mt-1 flex flex-col gap-1 text-sm">
          {o.now.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : (
        <p className="muted mt-1 text-sm">A quieter stretch: no big change is usual right now.</p>
      )}
      {o.next.length > 0 && (
        <p className="muted mt-2 text-sm">
          Coming up: {o.next.map((n) => `${n.what.split(":")[0].toLowerCase()} in about ${n.inAboutDays} days`).join("; ")}.
        </p>
      )}
      <p className="muted mt-1 text-xs">
        Usual awake window {o.awakeWindowMin[0]} to {o.awakeWindowMin[1]} min. Every baby differs; {name} sets her own pace.
      </p>
    </section>
  );
}
