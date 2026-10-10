import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { EntryType, Me, Subject } from "@/lib/types";
import { can } from "@/lib/types";
import { EntryForm } from "@/components/EntryForm";

export const dynamic = "force-dynamic";

export default async function EntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "lana", "view")) redirect("/");

  const { data: entry } = await supabase
    .from("care_entries")
    .select("id, subject_id, type_id, occurred_at, ended_at, payload, note, logged_by, attributed_to, deleted_at")
    .eq("id", id)
    .single();
  const e = entry as
    | { id: string; subject_id: string; type_id: string; occurred_at: string; ended_at: string | null; payload: Record<string, unknown>; note: string | null; deleted_at: string | null }
    | null;
  if (!e || e.deleted_at) redirect("/lana");
  const [{ data: subject }, { data: entryType }] = await Promise.all([
    supabase.from("care_subjects").select("*").eq("id", e.subject_id).single(),
    supabase.from("care_entry_types").select("*").eq("id", e.type_id).single(),
  ]);
  if (!subject || !entryType) redirect("/lana");

  return (
    <EntryForm
      mode="edit"
      entryId={e.id}
      subject={subject as Subject}
      entryType={entryType as EntryType}
      timezone={me.household.timezone}
      canEdit={can(me, "lana", "edit")}
      canDelete={can(me, "lana", "delete")}
      initial={{ payload: e.payload ?? {}, occurred_at: e.occurred_at, ended_at: e.ended_at, note: e.note ?? "" }}
    />
  );
}
