import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { HomeSummary, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { childPronouns, possessive } from "@/lib/names";
import { PageHeader } from "@/components/PageHeader";
import { TOPICS } from "@/lib/child-guide";

export const dynamic = "force-dynamic";

/** The ambulance number comes from the child's profile (emergency_ambulance), as on the emergency card. */
export default async function WhenToCallPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "lana", "view")) redirect("/");
  const { data: sumData } = await supabase.rpc("home_summary");
  const summary = sumData as HomeSummary | RpcError;
  if (!summary.ok) redirect("/");
  const p = (summary.subject.profile ?? {}) as Record<string, unknown>;
  const ambulance = typeof p.emergency_ambulance === "string" && p.emergency_ambulance.trim() ? p.emergency_ambulance.trim() : "998";
  const name = summary.subject.name;
  const pr = childPronouns(me);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/baby" title="When to call the doctor" subtitle="Warning signs from NHS, AAP and NICE guidance." />
      <div className="rounded-3xl bg-[var(--danger)] p-4 text-white">
        <p className="font-bold">Emergency? Call {ambulance} (ambulance) now.</p>
        <p className="text-sm opacity-90">Do not wait for the app. If you are unsure, call {pr.their} paediatrician.</p>
      </div>
      {TOPICS.map((t) => (
        <section key={t.id} id={t.id} className="card flex scroll-mt-4 flex-col gap-3">
          <h2 className="text-xl font-semibold">{t.title}</h2>
          <p className="notice notice-ok text-sm">
            <b>Usual: </b>
            {t.normal}
          </p>
          <div>
            <p className="font-bold">Call the doctor today if</p>
            <ul className="ml-5 list-disc text-sm">
              {t.call.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
          <div className="notice notice-danger">
            <p className="font-bold">Call {ambulance} or go to A&amp;E if</p>
            <ul className="ml-5 list-disc text-sm">
              {t.emergency.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
          <p className="muted text-xs">Sources: {t.src.join(" · ")}</p>
        </section>
      ))}
      <p className="muted text-xs">A summary of public health guidance, not a diagnosis. {possessive(name)} doctor knows {name} best.</p>
    </div>
  );
}
