import Link from "next/link";

export const LANA_TABS = [
  { id: "today", label: "Today" },
  { id: "patterns", label: "Patterns" },
  { id: "week", label: "Week" },
  { id: "handover", label: "Handover" },
  { id: "ask", label: "Ask" },
] as const;
export type LanaTab = (typeof LANA_TABS)[number]["id"];

/** The segmented control at the top of the child's section. Server-rendered links. */
export function LanaTabs({ active, day }: { active: LanaTab; day?: string }) {
  return (
    <nav aria-label="Child sections" className="grid grid-cols-5 gap-1 rounded-2xl bg-[var(--card-2)] p-1">
      {LANA_TABS.map((t) => (
        <Link
          key={t.id}
          href={t.id === "today" && day ? `/baby?tab=today&d=${day}` : `/baby?tab=${t.id}`}
          aria-current={active === t.id ? "page" : undefined}
          className={`rounded-xl py-2.5 text-center text-sm font-bold no-underline ${active === t.id ? "bg-[var(--card)] shadow-[var(--shadow)]" : "muted"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
