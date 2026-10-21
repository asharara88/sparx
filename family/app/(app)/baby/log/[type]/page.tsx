import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { EntryType, Me, Subject } from "@/lib/types";
import { can } from "@/lib/types";
import { EntryForm } from "@/components/EntryForm";

export const dynamic = "force-dynamic";

export default async function LogPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "lana", "add")) redirect("/");

  const [{ data: subject }, { data: entryType }] = await Promise.all([
    supabase.from("care_subjects").select("*").eq("kind", "child").eq("is_active", true).order("sort").limit(1).single(),
    supabase.from("care_entry_types").select("*").eq("module_id", "lana").eq("key", type).eq("is_active", true).single(),
  ]);
  if (!subject || !entryType) redirect("/");

  // Pre-fill from the most recent entry of this type (e.g. same bottle size).
  const { data: lastRows } = await supabase
    .from("care_entries")
    .select("payload")
    .eq("subject_id", (subject as Subject).id)
    .eq("type_id", (entryType as EntryType).id)
    .is("deleted_at", null)
    .order("occurred_at", { ascending: false })
    .limit(1);
  const lastPayload = ((lastRows?.[0] as { payload?: Record<string, unknown> } | undefined)?.payload ?? {}) as Record<string, unknown>;

  return (
    <EntryForm
      mode="create"
      subject={subject as Subject}
      entryType={entryType as EntryType}
      timezone={me.household.timezone}
      initial={{ payload: lastPayload, occurred_at: new Date().toISOString(), ended_at: null, note: "" }}
    />
  );
}
