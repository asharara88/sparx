import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { HomeSummary, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { childPronouns, possessive } from "@/lib/names";
import { PageHeader } from "@/components/PageHeader";
import { TOPICS } from "@/lib/child-guide";
import { meOnce } from "@/lib/server/me";
import { ambulanceOf } from "@/lib/emergency";
import { CallBanner } from "@/components/CallBanner";
import { Icon, type IconName } from "@/components/Icon";
import type { Tint } from "@/components/Fold";

export const dynamic = "force-dynamic";

/** Each topic's line icon and feature colour (DESIGN.md rule 7); fever is about no one feature. */
const TOPIC_LOOK: Record<string, { icon: IconName; tint?: Tint }> = {
  nappies: { icon: "diaper", tint: "diaper" },
  poo: { icon: "diaper", tint: "diaper" },
  feeds: { icon: "bottle", tint: "feed" },
  sleep: { icon: "zzz", tint: "sleep" },
  fever: { icon: "flame" },
};

/**
 * When to call the doctor: the ambulance line, then one row per topic, each opening its own
 * screen (it was five cards of boxes in boxes, 3.9 screens). The rows keep the topic ids, so an
 * old /baby/when-to-call#feeds link still lands on its row.
 */
export default async function WhenToCallPage() {
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me;
  if (!can(me, "lana", "view")) redirect("/");
  const { data: sumData } = await supabase.rpc("home_summary");
  const summary = sumData as HomeSummary | RpcError;
  if (!summary.ok) redirect("/");
  const name = summary.subject.name;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/baby?tab=about" title="When to call the doctor" subtitle="Warning signs from NHS, AAP and NICE guidance." />
      <CallBanner number={ambulanceOf(summary.subject.profile)} their={childPronouns(me).their} />
      <nav aria-label="Topics" className="card flex flex-col p-0">
        {TOPICS.map((t) => {
          const look = TOPIC_LOOK[t.id] ?? { icon: "clipboard" as IconName };
          return (
            <Link prefetch={false} key={t.id} id={t.id} href={`/baby/when-to-call/${t.id}`} className="row row-link scroll-mt-4 px-4">
              <span className={`icon-disc ${look.tint ? `tint-${look.tint}` : ""}`} style={{ width: 32, height: 32 }}>
                <Icon name={look.icon} size={17} />
              </span>
              <span className="flex-1 font-medium">{t.title}</span>
              <Icon name="forward" size={18} className="muted" />
            </Link>
          );
        })}
      </nav>
      <p className="muted text-sm">A summary of public health guidance, not a diagnosis. {possessive(name)} doctor knows {name} best.</p>
    </div>
  );
}
