"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

export function WakeUpButton({ entryId }: { entryId: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function wake() {
    setBusy(true);
    const supabase = supabaseBrowser();
    const { data: row } = await supabase.from("care_entries").select("occurred_at, payload, note").eq("id", entryId).single();
    const r = row as { occurred_at: string; payload: Record<string, unknown>; note: string | null } | null;
    await supabase.rpc("care_entry_update", {
      p_id: entryId,
      p_occurred_at: r?.occurred_at ?? null,
      p_ended_at: new Date().toISOString(),
      p_payload: r?.payload ?? {},
      p_note: r?.note ?? null,
    });
    setBusy(false);
    router.refresh();
  }
  return (
    <button className="btn btn-primary" onClick={wake} disabled={busy}>
      {busy ? "Saving…" : "Woke up"}
    </button>
  );
}
