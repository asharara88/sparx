"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PlanEntry, Suggestion } from "@/lib/types";
import { EVENT_KINDS } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";

const APPROVE: Record<Suggestion["kind"], string> = { reorder: "Add to the list", due: "Open", request: "Review", ticket: "Open", plan: "Put on the calendar" };
const ICON: Record<Suggestion["kind"], string> = { reorder: "🛒", due: "💉", request: "📥", ticket: "🔥", plan: "🗓️" };

/**
 * Approve / dismiss cards: what the data suggests doing today. Approving performs
 * the action with the member's own permissions; "Not now" keeps it quiet for a week.
 */
export function SuggestionCards({ suggestions, title = "Suggested" }: { suggestions: Suggestion[]; title?: string }) {
  const router = useRouter();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Record<string, Set<number>>>({});
  const list = suggestions.filter((s) => !gone.has(s.id));
  if (list.length === 0) return null;

  async function decide(s: Suggestion, decision: "approve" | "dismiss") {
    setBusy(s.id);
    const detail = s.kind === "plan" && picked[s.id] ? { entries: Array.from(picked[s.id]) } : null;
    const { data, error } = await supabaseBrowser().rpc("suggestion_decide", { p_id: s.id, p_decision: decision, p_days: 7, p_detail: detail });
    setBusy(null);
    const res = data as { ok: boolean; message?: string; entries?: number } | null;
    if (error || !res?.ok) return setMsg((m) => ({ ...m, [s.id]: res?.message ?? error?.message ?? "Could not do that." }));
    setGone((g) => new Set(g).add(s.id));
    if (decision === "approve") {
      if (s.kind === "plan") setMsg((m) => ({ ...m, done: `${res.entries ?? 0} ${res.entries === 1 ? "entry" : "entries"} put on the calendar.` }));
      if ((s.kind === "due" || s.kind === "request" || s.kind === "ticket") && s.href) router.push(s.href);
    }
    router.refresh();
  }
  function togglePick(s: Suggestion, i: number, total: number) {
    setPicked((p) => {
      const cur = new Set(p[s.id] ?? Array.from({ length: total }, (_, k) => k));
      if (cur.has(i)) cur.delete(i);
      else cur.add(i);
      return { ...p, [s.id]: cur };
    });
  }

  return (
    <section className="flex flex-col gap-2" aria-labelledby="sugg-h">
      <h2 id="sugg-h" className="text-xl font-semibold">
        {title}
      </h2>
      {msg.done && <p className="rounded-xl border-2 border-green-700 bg-green-50 p-3 font-semibold text-green-900">{msg.done}</p>}
      {list.map((s) => {
        const entries: PlanEntry[] = s.kind === "plan" && s.action && s.action.type === "plan" ? s.action.entries : [];
        const chosen = picked[s.id] ?? new Set(entries.map((_, i) => i));
        return (
          <article key={s.id} className="card border-2 border-[var(--accent)]">
            <p className="text-lg font-bold">
              <span aria-hidden>{ICON[s.kind]} </span>
              {s.href && s.kind !== "plan" ? (
                <Link href={s.href} className="underline decoration-dotted">
                  {s.title}
                </Link>
              ) : (
                s.title
              )}
            </p>
            {s.body && <p className="muted mt-1 whitespace-pre-wrap text-sm">{s.body}</p>}
            {entries.length > 0 && (
              <ul className="mt-2 flex flex-col gap-2">
                {entries.map((e, i) => (
                  <li key={i}>
                    <label className="flex items-start gap-3">
                      <input type="checkbox" className="mt-1 h-7 w-7" checked={chosen.has(i)} onChange={() => togglePick(s, i, entries.length)} />
                      <span>
                        <span className="block font-semibold">
                          {EVENT_KINDS.find((k) => k.id === e.kind)?.icon} {e.date}
                          {e.time ? ` ${e.time}` : ""} · {e.title}
                        </span>
                        {e.note && <span className="muted block text-sm">{e.note}</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {msg[s.id] && (
              <p role="alert" className="mt-1 text-sm text-red-800">
                {msg[s.id]}
              </p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" className="btn" onClick={() => decide(s, "dismiss")} disabled={busy === s.id}>
                Not now
              </button>
              <button type="button" className="btn btn-primary" onClick={() => decide(s, "approve")} disabled={busy === s.id || (s.kind === "plan" && chosen.size === 0)}>
                {busy === s.id ? "…" : s.kind === "plan" ? `${APPROVE.plan} (${chosen.size})` : APPROVE[s.kind]}
              </button>
            </div>
          </article>
        );
      })}
    </section>
  );
}
