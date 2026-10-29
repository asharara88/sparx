import Link from "next/link";
import type { HomeSummary, Me } from "@/lib/types";
import { can } from "@/lib/types";
import { ageDays, ageLabel } from "@/lib/norms";
import { Avatar } from "./Avatar";
import { CustodyToggle } from "./CustodyToggle";
import { SayIt } from "./SayIt";
import { Icon } from "./Icon";

/**
 * The top of Home: the child's photo, name, age and who has her on the left; on the right
 * two round buttons, Say it and Emergency. They sit high, out of the thumb's easy reach,
 * on purpose: always there, never tapped by accident (DESIGN.md, "Home").
 */
export function HomeHeader({ summary, me, today }: { summary: HomeSummary; me: Me; today: string }) {
  const s = summary.subject;
  const photo = (s.profile?.photo_path as string | undefined) ?? null;
  const age = s.birth_date ? `${ageLabel(ageDays(s.birth_date, today))}` : null;
  return (
    <header className="flex items-center gap-3 pt-2">
      <Avatar name={s.name} path={photo} size={48} />
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-[family-name:var(--font-display)] text-2xl font-semibold leading-tight">{s.name}</h1>
        <p className="muted truncate text-[0.95rem]">
          {age && <>{age} · </>}
          <CustodyToggle inline subjectId={s.id} custody={summary.custody} />
        </p>
      </div>
      {can(me, "assistant", "add") && can(me, "lana", "add") && <SayIt icon />}
      <Link href="/baby/emergency" className="round-btn tint-danger" aria-label="Emergency">
        <Icon name="phone" size={21} />
      </Link>
    </header>
  );
}
