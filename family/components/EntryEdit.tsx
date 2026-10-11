import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { EntryType, Me, Subject } from "@/lib/types";
import { can } from "@/lib/types";
import { EntryForm } from "@/components/EntryForm";

/** The edit screen for one care entry, for whichever subject it belongs to. */
export async function EntryEdit({ id, fallback }: { id: string; fallback: string }) {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  const { data: entry } = await supabase
    .from("care_entries")
    .select("id, subject_id, module_id, type_id, occurred_at, ended_at, payload, note, deleted_at")
    .eq("id", id)
    .single();
  const e = entry as
    | { id: string; subject_id: string; module_id: string; type_id: string; occurred_at: string; ended_at: string | null; payload: Record<string, unknown>; note: string | null; deleted_at: string | null }
    | null;
  if (!e || e.deleted_at || !can(me, e.module_id, "view")) redirect(fallback);
  const [{ data: subject }, { data: entryType }] = await Promise.all([
    supabase.from("care_subjects").select("*").eq("id", e.subject_id).single(),
    supabase.from("care_entry_types").select("*").eq("id", e.type_id).single(),
  ]);
  if (!subject || !entryType) redirect(fallback);
  return (
    <EntryForm
      mode="edit"
      entryId={e.id}
      subject={subject as Subject}
      entryType={entryType as EntryType}
      timezone={me.household.timezone}
      canEdit={can(me, e.module_id, "edit")}
      canDelete={can(me, e.module_id, "delete")}
      initial={{ payload: e.payload ?? {}, occurred_at: e.occurred_at, ended_at: e.ended_at, note: e.note ?? "" }}
    />
  );
}
