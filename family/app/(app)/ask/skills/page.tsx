import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AssistantSkill, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { SkillEditor } from "@/components/SkillEditor";
import { PageHeader } from "@/components/PageHeader";
import { meOnce } from "@/lib/server/me";

export const dynamic = "force-dynamic";

/** Admins: what the helper knows, topic by topic, editable without a deploy. */
export default async function SkillsPage() {
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me;
  if (!can(me, "assistant", "edit")) redirect("/ask");
  const { data } = await supabase.rpc("skill_list", { p_all: true });
  const res = data as { ok: true; items: AssistantSkill[] } | RpcError | null;
  const skills = res && res.ok ? res.items : [];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/ask" title="Helper skills" subtitle="What the helper knows, one topic at a time. Trigger words call a skill into an answer; always-on skills are in every answer. Say where a fact comes from." />
      {!me.platform && (
        <p className="notice notice-accent">
          This is shared by every home on elnunu, so only the first home&apos;s admins change it. What you see here is what applies to yours.
        </p>
      )}
      <SkillEditor skills={skills} />
      <p className="muted text-xs">A skill is guidance, not a prescription: keep medicines and doses out, and keep red flags pointing to the doctor. Every save is versioned and audited.</p>
    </div>
  );
}
