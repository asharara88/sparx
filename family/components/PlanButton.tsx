"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RpcError, Suggestion } from "@/lib/types";
import { SuggestionCards } from "./SuggestionCards";
import { apiFetch } from "@/lib/supabase/client";
import { Icon } from "@/components/Icon";

/**
 * "Draft next week": the helper's plan from the calendar, who is home, what is due and what is
 * low. Under the days as a quiet line with the helper's sparkles (no fill, no box), so the
 * screen's one filled button stays "+ Add to the calendar"; the draft it made sits above it.
 * The label stays short enough for one line at 320 px in large text.
 */
export function PlanButton({ existing }: { existing: Suggestion | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState<Suggestion | null>(existing);

  async function go() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiFetch("/api/plan/draft", { method: "POST" });
      const out = (await r.json()) as { ok: true; suggestion: Suggestion | null } | RpcError;
      if (!out.ok) return setMsg(out.message ?? "Could not draft the plan.");
      setDraft(out.suggestion);
      router.refresh();
    } catch {
      setMsg("No connection.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-2">
      {draft ? <SuggestionCards suggestions={[draft]} title="Next week" /> : null}
      <button type="button" className="btn btn-ghost w-full" onClick={go} disabled={busy}>
        <Icon name="sparkles" size={18} />
        {busy ? "Drafting next week…" : draft ? "Draft it again" : "Draft next week"}
      </button>
      {msg && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {msg}
        </p>
      )}
    </div>
  );
}
