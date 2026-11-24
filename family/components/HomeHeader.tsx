import Link from "next/link";
import type { HomeSummary } from "@/lib/types";
import { Avatar } from "./Avatar";
import { CustodyToggle } from "./CustodyToggle";
import { Icon } from "./Icon";

/**
 * The top of Home: the child's photo, name and who has her on the left (her age is on her own
 * screen; it left Home on 24 November to bring the first screen back to 15 numbers); on the
 * right the round Emergency button. It sits high, out of the thumb's easy reach, on purpose:
 * always there, never tapped by accident (DESIGN.md, "Home"). The mic moved down into the
 * "Tell me" bar at the thumb (9 November).
 */
export function HomeHeader({ summary }: { summary: HomeSummary }) {
  const s = summary.subject;
  const photo = (s.profile?.photo_path as string | undefined) ?? null;
  return (
    <header className="flex items-center gap-3 pt-2">
      <Avatar name={s.name} path={photo} size={48} />
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-[family-name:var(--font-display)] text-2xl font-semibold leading-tight">{s.name}</h1>
        {/* A div, not a <p>: the custody switch holds a menu, and nothing here clips it. */}
        <div className="muted flex min-w-0 items-center gap-1 text-[0.95rem]">
          <CustodyToggle inline subjectId={s.id} custody={summary.custody} />
        </div>
      </div>
      <Link prefetch={false} href="/baby/emergency" className="round-btn tint-danger" aria-label="Emergency">
        <Icon name="phone" size={21} />
      </Link>
    </header>
  );
}
