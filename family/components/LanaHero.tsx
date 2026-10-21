import type { HomeSummary, Me } from "@/lib/types";
import { ageDays, ageLabel } from "@/lib/norms";
import { Avatar } from "./Avatar";
import { CustodyToggle } from "./CustodyToggle";
import { ProfileMenu } from "./ProfileMenu";
import { Mark } from "./Brand";

/** The child at the top of Home: photo, age, who has the child, and your own menu. */
export function LanaHero({ summary, me, today, dateLine }: { summary: HomeSummary; me: Me; today: string; dateLine: string }) {
  const s = summary.subject;
  const photo = (s.profile?.photo_path as string | undefined) ?? null;
  const age = s.birth_date ? `${ageLabel(ageDays(s.birth_date, today))} old` : "";
  return (
    <header className="page-header page-header-large">
      <div className="flex items-center gap-3">
        <Avatar name={s.name} path={photo} size={64} />
        <div className="min-w-0 flex-1">
          <p className="muted flex items-center gap-1.5 text-sm">
            <Mark size={16} title="elnunu" /> {dateLine}
          </p>
          <h1 className="page-title">{s.name}</h1>
          {age && <p className="muted">{age}</p>}
        </div>
        <ProfileMenu name={me.member.display_name} path={me.member.photo_path} />
      </div>
      <div className="mt-2">
        <CustodyToggle subjectId={s.id} custody={summary.custody} />
      </div>
    </header>
  );
}
