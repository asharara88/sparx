"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Activity } from "@/lib/types";
import { can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Icon } from "@/components/Icon";

/** Play ideas for her age, a tick each. The next age band shows below as "coming". */
export function Activities({ subjectId, items, compact = false }: { subjectId: string; items: Activity[]; compact?: boolean }) {
  const me = useMe();
  const router = useRouter();
  const canTick = can(me, "lana", "add");
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const now = items.filter((a) => a.band === "now");
  const coming = items.filter((a) => a.band === "coming");
  const shown = compact ? now.filter((a) => !a.done_on).slice(0, 3) : now;

  async function tick(a: Activity) {
    setBusy(a.id);
    await supabaseBrowser().rpc("activity_tick", { p_subject_id: subjectId, p_activity_id: a.id, p_done: !a.done_on, p_note: null });
    setBusy(null);
    router.refresh();
  }

  const Row = ({ a }: { a: Activity }) => (
    <li className="row flex-col items-stretch">
      <div className="flex items-start gap-3">
        {canTick && a.band === "now" ? (
          <button type="button" className={`icon-btn m-0 shrink-0 ${a.done_on ? "bg-[var(--ok)] text-white" : ""}`} style={{ width: 40, height: 40, minHeight: 40 }} aria-pressed={!!a.done_on} aria-label={a.done_on ? `Done: ${a.title}` : `Mark done: ${a.title}`} disabled={busy === a.id} onClick={() => void tick(a)}>
            <Icon name="check" size={18} />
          </button>
        ) : (
          <span className="w-10 shrink-0" />
        )}
        <button type="button" className="min-w-0 grow text-left" onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id}>
          <span className={`block font-semibold ${a.done_on ? "muted line-through" : ""}`}>{a.title}</span>
          <span className="muted block text-sm">{a.how}</span>
        </button>
      </div>
      {open === a.id && (
        <div className="muted mt-2 pl-[52px] text-sm">
          <p>{a.why}</p>
          <p className="mt-1 text-xs">Source: {a.source}</p>
          {a.done_on && (
            <p className="mt-1 text-xs">
              Done {a.done_on}
              {a.done_by ? ` by ${a.done_by}` : ""}
            </p>
          )}
        </div>
      )}
    </li>
  );

  if (compact) {
    if (shown.length === 0) return null;
    return (
      <section className="card" aria-labelledby="play-h">
        <div className="flex items-baseline justify-between">
          <h2 id="play-h" className="font-semibold">
            Play ideas for her age
          </h2>
          <a href="/lana/activities" className="text-sm font-semibold text-[var(--accent)]">
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
        <h2 className="font-semibold">For her age now</h2>
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
      {coming.length > 0 && (
        <section className="card">
          <h2 className="font-semibold">Coming next</h2>
          <p className="muted text-sm">From about {Math.round(coming[0].from_days / 30.44)} months.</p>
          <ul className="mt-1 flex flex-col">
            {coming.map((a) => (
              <Row key={a.id} a={a} />
            ))}
          </ul>
        </section>
      )}
      <p className="muted text-xs">Ideas drawn from NHS Start for Life, AAP HealthyChildren and CDC milestones. Play is not a test: skip anything she is not in the mood for.</p>
    </div>
  );
}
