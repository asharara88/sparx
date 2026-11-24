import Link from "next/link";
import { dayHref } from "@/lib/day-nav";

/**
 * Feeds | Sleep, under a section's title (DESIGN.md, "Segmented control"): one tap across to
 * the other section, on the day this one is showing. Until 24 November the way across was
 * back out to the child's screen and in again.
 */
export function SectionSwitch({ current, day, today }: { current: "feed" | "sleep"; day: string; today: string }) {
  const link = (key: "feed" | "sleep", label: string) => (
    <Link prefetch={false} href={dayHref(`/baby/${key}`, day, today)!} aria-current={current === key ? "page" : undefined}>
      {label}
    </Link>
  );
  return (
    <nav className="segmented" aria-label="Feeds or sleep">
      {link("feed", "Feeds")}
      {link("sleep", "Sleep")}
    </nav>
  );
}
