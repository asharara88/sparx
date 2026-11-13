"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Activity } from "@/lib/types";
import { can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Icon } from "@/components/Icon";
import { Fold } from "@/components/Fold";
import { childPronouns } from "@/lib/names";

/** Play ideas for the child's age, a tick each. The next age band shows below as "coming". */
export function Activities({ subjectId, items, compact = false }: { subjectId: string; items: Activity[]; compact?: boolean }) {
  const me = useMe();
  const pr = childPronouns(me);
  const router = useRouter();
  const canTick = can(me, "lana", "add");
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // A tick that did not save, said under its own row.
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);
  const now = items.filter((a) => a.band === "now");
  const coming = items.filter((a) => a.band === "coming");
  // Three a day, rotating through what the child has not tried yet so the same three do not sit there for a month.
  const pending = now.filter((a) => !a.done_on);
  const offset = pending.length ? (Math.floor(Date.now() / 86_400_000) * 3) % pending.length : 0;
  const shown = compact ? [...pending.slice(offset), ...pending.slice(0, offset)].slice(0, 3) : now;

  async function tick(a: Activity) {
    setBusy(a.id);
    setFailed(null);
    const { data, error } = await supabaseBrowser().rpc("activity_tick", { p_subject_id: subjectId, p_activity_id: a.id, p_done: !a.done_on, p_note: null });
    setBusy(null);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setFailed({ id: a.id, message: res?.message ?? error?.message ?? "Could not save that tick. Try again." });
    router.refresh();
  }

  const Row = ({ a }: { a: Activity }) => {
    const hasTick = canTick && a.band === "now";
    // The detail lines up under the title: the tick's 44 px and the 12 px gap.
    const inset = hasTick ? "pl-[56px]" : "";
    return (
    <li className="row flex-col items-stretch">
      <div className="flex items-start gap-3">
        {hasTick && (
          <button type="button" className="tick" aria-pressed={!!a.done_on} aria-label={a.done_on ? `Done: ${a.title}` : `Mark done: ${a.title}`} disabled={busy === a.id} onClick={() => void tick(a)}>
            <Icon name="check" size={18} />
          </button>
        )}
        <button type="button" className="min-w-0 grow text-left" onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id}>
          <span className={`block font-semibold ${a.done_on ? "muted line-through" : ""}`}>{a.title}</span>
          <span className="muted block text-sm">{a.how}</span>
        </button>
      </div>
      {failed?.id === a.id && (
        <p role="alert" className={`mt-1 ${inset} text-sm text-[var(--danger)]`}>
          {failed.message}
        </p>
      )}
      {open === a.id && (
        <div className={`muted mt-2 ${inset} text-sm`}>
          <p>{a.why}</p>
          <p className="mt-1">Source: {a.source}</p>
          {a.done_on && (
            <p className="mt-1">
              Done {a.done_on}
              {a.done_by ? ` by ${a.done_by}` : ""}
            </p>
          )}
        </div>
      )}
    </li>
    );
  };

  if (compact) {
    if (shown.length === 0) return null;
    return (
      <section className="card" aria-labelledby="play-h">
        <div className="flex items-baseline justify-between">
          <h2 id="play-h" className="font-semibold">
            Play ideas for {pr.their} age
          </h2>
          <a href="/baby/activities" className="text-sm font-semibold text-[var(--accent)]">
            All ›
          </a>
        </div>
        <ul className="mt-1 flex flex-col">
          {shown.map((a) => (
            <Row key={a.id} a={a} />
          ))}
        </ul>
      </section>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <section className="card">
        <h2 className="font-semibold">For {pr.their} age now</h2>
        <p className="muted text-sm">
          {now.filter((a) => a.done_on).length} of {now.length} tried. Tap the tick when you have done one; tap the title for why it helps.
        </p>
        <ul className="mt-1 flex flex-col">
          {now.map((a) => (
            <Row key={a.id} a={a} />
          ))}
          {now.length === 0 && <li className="muted text-sm">No ideas for this age yet.</li>}
        </ul>
      </section>
      {/* What comes later is a list of names, folded: nothing to do with it yet. */}
      {coming.length > 0 && (
        <Fold title="Coming next" hint={`from about ${Math.round(coming[0].from_days / 30.44)} months`}>
          <ul className="flex flex-col">
            {coming.map((a) => (
              <li key={a.id} className="row">
                {a.title}
              </li>
            ))}
          </ul>
        </Fold>
      )}
      <p className="muted text-sm">Ideas drawn from NHS Start for Life, AAP HealthyChildren and CDC milestones. Play is not a test: skip anything {pr.they} {pr.is} not in the mood for.</p>
    </div>
  );
}
