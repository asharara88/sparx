import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { HomeSummary, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { childPronouns, possessive } from "@/lib/names";
import { PageHeader } from "@/components/PageHeader";
import { topicsFor } from "@/lib/child-guide";
import { ageDays } from "@/lib/norms";
import { todayYmd } from "@/lib/time";
import { meOnce } from "@/lib/server/me";
import { ambulanceOf } from "@/lib/emergency";
import { CallBanner } from "@/components/CallBanner";

export const dynamic = "force-dynamic";

/** One topic of When to call: what is usual, when to call the doctor today, when to call the ambulance. */
export default async function WhenToCallTopicPage({ params }: { params: Promise<{ topic: string }> }) {
  const { topic } = await params;
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me;
  if (!can(me, "lana", "view")) redirect("/");
  const { data: sumData } = await supabase.rpc("home_summary");
  const summary = sumData as HomeSummary | RpcError;
  if (!summary.ok) redirect("/");
  // The child's own age picks the lines (R9): a toddler's page only takes away.
  const birth = summary.subject.birth_date;
  const t = topicsFor(birth ? ageDays(birth, todayYmd(me.household.timezone)) : null).find((x) => x.id === topic);
  if (!t) notFound();
  const number = ambulanceOf(summary.subject.profile);
  const ambulance = number ?? "your local emergency number";
  const name = summary.subject.name;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/baby/when-to-call" title={t.title} />
      <CallBanner number={number} their={childPronouns(me).their} />
      {/* Plain words for what is usual: green is not used to mean "fine" (DESIGN.md rule 7). */}
      <section className="card flex flex-col gap-3" aria-label={t.title}>
        {/* From 12 months most topics have no "usual" line: an empty one is not drawn. */}
        {t.normal && (
          <p>
            <b>Usual: </b>
            {t.normal}
          </p>
        )}
        <div>
          <p className="font-bold">Call the doctor today if</p>
          <ul className="ml-5 list-disc">
            {t.call.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      </section>
      <div className="notice notice-danger">
        <p className="font-bold">Call {ambulance} or go to A&amp;E if</p>
        <ul className="ml-5 list-disc">
          {t.emergency.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
      <p className="muted text-sm">
        Sources: {t.src.join(" · ")}. A summary of public health guidance, not a diagnosis. {possessive(name)} doctor knows {name} best.
      </p>
    </div>
  );
}
