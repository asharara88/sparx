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

/**
 * Play ideas for the child's age, a tick each. The next age band shows below as "coming".
 * The list is every idea for the age, so a row is the idea's name and a tap opens how to do
 * it, why it helps and the source: eighteen ideas with a sentence each were 406 words on a
 * screen whose budget is 150 (DESIGN.md, "The small screens"). The three-a-day card this
 * component once drew on the child's page left on 29 October; its code left with this change.
 */
export function Activities({ subjectId, items }: { subjectId: string; items: Activity[] }) {
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

  async function tick(a: Activity) {
    setBusy(a.id);
    setFailed(null);
    const { data, error } = await supabaseBrowser().rpc("activity_tick", { p_subject_id: subjectId, p_activity_id: a.id, p_done: !a.done_on, p_note: null });
    setBusy(null);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setFailed({ id: a.id, message: res?.message ?? error?.message ?? "Could not save that tick. Try again." });
    router.refresh();
  }

  // Called as a function, not rendered as <Row />: a component made anew on every render is a
  // new component to React, which rebuilt every row at each tap and dropped the keyboard's
  // place on the name just pressed.
  const row = (a: Activity) => {
    // The detail lines up under the name: the tick's 44 px and the 12 px gap.
    const inset = canTick ? "pl-[56px]" : "";
    return (
      <li key={a.id} className="row flex-col items-stretch">
        <div className="flex items-center gap-3">
          {canTick && (
            <button type="button" className="tick" aria-pressed={!!a.done_on} aria-label={a.done_on ? `Done: ${a.title}` : `Mark done: ${a.title}`} disabled={busy === a.id} onClick={() => void tick(a)}>
              <Icon name="check" size={18} />
            </button>
          )}
          <button type="button" className="min-h-[44px] min-w-0 grow text-left" onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id}>
            {/* Under 360 px the name steps down a size so a short one stays on its line beside the tick
                ("Grass under the hands" broke in two at 320 px in large text). In px, so large text does not undo it. */}
            <span className={`block font-semibold max-[360px]:text-[16px] ${a.done_on ? "muted line-through" : ""}`}>{a.title}</span>
          </button>
        </div>
        {failed?.id === a.id && (
          <p role="alert" className={`mt-1 ${inset} text-sm text-[var(--danger)]`}>
            {failed.message}
          </p>
        )}
        {open === a.id && (
          <div className={`muted mt-1 ${inset} text-sm`}>
            <p className="mb-1 text-[var(--fg)]">{a.how}</p>
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

  return (
    <div className="flex flex-col gap-4">
      <section className="card">
        <h2 className="font-semibold">For {pr.their} age now</h2>
        <p className="muted text-sm">
          {now.filter((a) => a.done_on).length} of {now.length} tried. {canTick ? "Tap the tick when you have done one; tap a name for how and why." : "Tap a name for how and why."}
        </p>
        <ul className="mt-1 flex flex-col">
          {now.map((a) => row(a))}
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
