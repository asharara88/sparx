import Link from "next/link";

export const LANA_TABS = ["today", "week", "about"] as const;
export type LanaTab = (typeof LANA_TABS)[number];

/**
 * The segmented control at the top of the child's page: Today / Week / About her
 * (DESIGN.md, "The child's page"). Server-rendered links, 44 px tall, one line each.
 */
export function LanaTabs({ active, day, them }: { active: LanaTab; day?: string; them: string }) {
  const label: Record<LanaTab, string> = { today: "Today", week: "Week", about: `About ${them}` };
  return (
    <nav aria-label="Child sections" className="grid grid-cols-3 gap-1 rounded-2xl bg-[var(--card-2)] p-1">
      {LANA_TABS.map((t) => (
        <Link
          key={t}
          href={t === "today" && day ? `/baby?tab=today&d=${day}` : `/baby?tab=${t}`}
          aria-current={active === t ? "page" : undefined}
          className={`flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-xl text-center text-sm font-bold no-underline ${active === t ? "bg-[var(--card)] shadow-[var(--shadow)]" : "muted"}`}
        >
          {label[t]}
        </Link>
      ))}
    </nav>
  );
}
