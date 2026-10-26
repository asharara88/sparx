"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EntryRow } from "@/lib/types";
import { checkEntries, type CheckFlag } from "@/lib/entry-checks";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtDateTime, fmtTime, ISO_IN_TEXT } from "@/lib/time";
import { useMe } from "@/lib/me-context";
import { childName, possessive } from "@/lib/names";

/**
 * "Does this look right?" One card per suspicious entry, with the fix the
 * data supports. Shown on Home (the first two) and on the child's Today (all).
 * Every decision is one tap and audited.
 */
export function EntryChecks({ entries, timezone, limit, canDelete, compact = false }: { entries: EntryRow[]; timezone: string; limit?: number; canDelete: boolean; compact?: boolean }) {
  const me = useMe();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const all = checkEntries(entries).filter((f) => !hidden.has(f.id));
  const flags = limit ? all.slice(0, limit) : all;
  if (flags.length === 0) return null;
  // Home: one line, the decisions wait on the child's page where there is room for them.
  if (compact) {
    return (
      <a href="/baby" className="notice notice-warn row-link flex items-center gap-3 no-underline">
        <span className="font-semibold">
          {all.length === 1 ? "1 entry" : `${all.length} entries`} to check: {all[0].title.replace(/\.$/, "").toLowerCase()}
        </span>
        <span aria-hidden className="ml-auto">
          ›
        </span>
      </a>
    );
  }

  async function act(f: CheckFlag, action: "ok" | "end" | "delete") {
    setBusy(f.id);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("care_entry_check", { p_id: f.entry.id, p_action: action, p_ended_at: action === "end" ? f.fix?.ended_at ?? null : null });
    const res = data as { ok: boolean; message?: string } | null;
    setBusy(null);
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    setHidden((h) => new Set(h).add(f.id));
    router.refresh();
  }
  const when = (iso: string) => (Date.now() - Date.parse(iso) < 20 * 3_600_000 ? fmtTime(iso, timezone) : fmtDateTime(iso, timezone));

  return (
    <section className="flex flex-col gap-2" aria-label="Entries to check">
      {flags.map((f) => (
        <div key={f.id} className="card ring-2 ring-[var(--accent)]">
          <p className="text-lg font-bold">{f.title}</p>
          <p className="muted text-sm">
            {f.entry.type_id.split(".")[1]} at {when(f.entry.occurred_at)}. {f.detail.replace(ISO_IN_TEXT, (iso) => when(iso))}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {f.fix && (
              <button type="button" className="btn btn-primary" disabled={busy === f.id} onClick={() => void act(f, "end")}>
                {f.fix.label} ({when(f.fix.ended_at)})
              </button>
            )}
            {f.suggestDelete && canDelete && (
              <button type="button" className={`btn ${f.fix ? "" : "btn-primary"}`} disabled={busy === f.id} onClick={() => void act(f, "delete")}>
                Remove it
              </button>
            )}
            <button type="button" className="btn" disabled={busy === f.id} onClick={() => void act(f, "ok")}>
              It was real
            </button>
            {!f.fix && !f.suggestDelete && (
              <a href={`/entry/${f.entry.id}`} className="btn">
                Fix the times
              </a>
            )}
          </div>
        </div>
      ))}
      {all.length > flags.length && (
        <a href="/baby" className="muted px-1 text-sm">
          {all.length - flags.length} more to check on {possessive(childName(me))} page ›
        </a>
      )}
      {msg && (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {msg}
        </p>
      )}
    </section>
  );
}
