import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Me, Presence, PresenceState } from "@/lib/types";
import { PresenceForm } from "@/components/PresenceForm";
import { PageHeader } from "@/components/PageHeader";
import { meOnce } from "@/lib/server/me";

export const dynamic = "force-dynamic";

/** Where you are (lives here, staying, away…): a setting, so it has its own page under More. */
export default async function MyPresencePage() {
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me | null;
  if (!me?.ok) redirect("/");
  const [{ data: states }, { data: history }] = await Promise.all([
    supabase.from("presence_states").select("*").order("sort"),
    supabase.from("presence").select("*").eq("member_id", me.member.id).order("starts_on", { ascending: false }).limit(5),
  ]);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/me" title="Where you are" />
      <PresenceForm memberId={me.member.id} states={(states as PresenceState[]) ?? []} history={(history as Presence[]) ?? []} title="Where are you?" />
    </div>
  );
}
