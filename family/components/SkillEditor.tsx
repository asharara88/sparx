"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AssistantSkill } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Icon } from "@/components/Icon";

/**
 * The helper's skills, editable in place. A skill is what it knows about one
 * topic and the words that call it in. Always-on skills go into every answer.
 * Saving bumps the version and is audited; nothing needs a deploy.
 */
const EMPTY: AssistantSkill = { id: "", title: "", when: "", triggers: [], body: "", sources: "", always_on: false, age_from_days: null, age_to_days: null, sort: 100, is_active: true };

export function SkillEditor({ skills }: { skills: AssistantSkill[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<AssistantSkill | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function edit(s: AssistantSkill) {
    setOpen(s.id || "new");
    setDraft({ ...s });
    setMsg(null);
  }
  async function save() {
    if (!draft) return;
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("skill_save", {
      p_id: draft.id,
      p_title: draft.title,
      p_when: draft.when,
      p_triggers: draft.triggers,
      p_body: draft.body,
      p_sources: draft.sources,
      p_always_on: draft.always_on,
      p_age_from_days: draft.age_from_days,
      p_age_to_days: draft.age_to_days,
      p_sort: draft.sort,
      p_is_active: draft.is_active,
    });
    const res = data as { ok: boolean; message?: string } | null;
    setBusy(false);
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    setMsg("Saved.");
    setOpen(null);
    setDraft(null);
    router.refresh();
  }
  const months = (d: number | null) => (d == null ? "" : String(Math.round(d / 30.44)));
  const days = (m: string) => (m.trim() === "" ? null : Math.round(Number(m) * 30.44));

  const Form = () =>
    draft && (
      <div className="card mt-2 flex flex-col gap-2 ring-2 ring-[var(--accent)]">
        {!skills.some((s) => s.id === draft.id) && (
          <label className="flex flex-col gap-1 text-sm">
            Id (letters, digits, _)
            <input className="input" value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} placeholder="e.g. travel" />
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm">
          Title
          <input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          When to use it (one line, shown in the index)
          <input className="input" value={draft.when} onChange={(e) => setDraft({ ...draft, when: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Trigger words, comma-separated (English, Arabic, Russian)
          <textarea className="input" rows={3} value={draft.triggers.join(", ")} onChange={(e) => setDraft({ ...draft, triggers: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          What it knows
          <textarea className="input" rows={12} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Sources
          <input className="input" value={draft.sources} onChange={(e) => setDraft({ ...draft, sources: e.target.value })} placeholder="NHS; AAP" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-sm">
            From (months)
            <input className="input" inputMode="decimal" value={months(draft.age_from_days)} onChange={(e) => setDraft({ ...draft, age_from_days: days(e.target.value) })} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            To (months)
            <input className="input" inputMode="decimal" value={months(draft.age_to_days)} onChange={(e) => setDraft({ ...draft, age_to_days: days(e.target.value) })} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.always_on} onChange={(e) => setDraft({ ...draft, always_on: e.target.checked })} /> Always on (in every answer)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} /> Active
        </label>
        {msg && <p className={`text-sm ${msg === "Saved." ? "text-[var(--ok)]" : "text-[var(--danger)]"}`}>{msg}</p>}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn" onClick={() => (setOpen(null), setDraft(null))} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || !draft.title.trim() || draft.body.trim().length < 20}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      <button type="button" className="btn" onClick={() => edit(EMPTY)}>
        <Icon name="plus" size={18} /> New skill
      </button>
      {open === "new" && <Form />}
      <ul className="card flex flex-col">
        {skills.map((s) => (
          <li key={s.id} className="row flex-col items-stretch">
            <button type="button" className="flex items-center justify-between gap-2 text-left" onClick={() => (open === s.id ? (setOpen(null), setDraft(null)) : edit(s))} aria-expanded={open === s.id}>
              <span className="min-w-0">
                <span className={`block font-semibold ${s.is_active ? "" : "muted line-through"}`}>
                  {s.title} {s.always_on && <span className="pill">always on</span>}
                </span>
                <span className="muted block text-sm">
                  {s.when} {s.age_from_days != null || s.age_to_days != null ? `· ${months(s.age_from_days) || "0"} to ${months(s.age_to_days) || "any"} months` : ""} · v{s.version ?? 1}
                  {s.updated_by ? ` by ${s.updated_by}` : ""}
                </span>
              </span>
              <Icon name={open === s.id ? "x" : "forward"} size={18} className="shrink-0 text-[var(--muted)]" />
            </button>
            {open === s.id && <Form />}
          </li>
        ))}
      </ul>
    </div>
  );
}
