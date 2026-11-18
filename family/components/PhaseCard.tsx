import Link from "next/link";
import type { PhaseCardText } from "@/lib/child-insights";

/**
 * What the child's age usually brings now, and what comes next (lib/child-insights,
 * phaseCard). From 12 months it is the heading, one link to the stretch in Week by week,
 * and the line that every child differs.
 */
export function PhaseCard({ card }: { card: PhaseCardText }) {
  // A baby's card has the phases (or a quieter stretch); a toddler's has neither.
  const baby = card.now.length > 0 || card.quiet != null;
  const link = card.link && (
    <Link prefetch={false} href="/baby/weeks" className="mt-1 flex min-h-[44px] items-center text-sm font-semibold text-[var(--accent)] no-underline">
      {card.link}
    </Link>
  );
  return (
    <section className="card" aria-labelledby="phase-h">
      <h2 id="phase-h" className="font-semibold">
        {card.heading}
      </h2>
      {card.now.length > 0 ? (
        <ul className="mt-1 flex flex-col gap-1 text-sm">
          {card.now.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : (
        card.quiet && <p className="muted mt-1 text-sm">{card.quiet}</p>
      )}
      {card.coming && <p className="muted mt-2 text-sm">{card.coming}</p>}
      {!baby && link}
      <p className="muted mt-1 text-xs">{card.foot}</p>
      {baby && link}
    </section>
  );
}
