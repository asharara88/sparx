"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EntryType } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Icon } from "@/components/Icon";

/**
 * Admin: the kinds of entry Lana's and Fanta's logs accept. Rename, reorder, switch off,
 * set "due again after N minutes" (what the home screen counts down), and edit the fields
 * each entry asks for (a JSON list, same shape as the seed).
 */
export function EntryTypesAdmin({ types, modules }: { types: EntryType[]; modules: { id: string; label: string }[] }) {
  const router = useRouter();
  const blank = { id: null as string | null, module_id: modules[0]?.id ?? "lana", key: "", label: "", icon: "", sort: 100, has_end: false, due_after_min: "" as string | number, fields: "[]", show_on_home: false, is_active: true };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  function edit(t: EntryType) {
    setF({ id: t.id, module_id: t.module_id, key: t.key, label: t.label, icon: t.icon ?? "", sort: t.sort, has_end: t.has_end, due_after_min: t.due_after_min ?? "", fields: JSON.stringify(t.fields, null, 1), show_on_home: t.show_on_home, is_active: t.is_active });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    let fields: unknown;
    try {
      fields = JSON.parse(f.fields || "[]");
    } catch {
      setBusy(false);
      return setMsg("Fields must be valid JSON.");
    }
    const { data, error } = await supabaseBrowser().rpc("entry_type_save", {
      p_id: f.id,
      p_module_id: f.module_id,
      p_key: f.key.trim(),
      p_label: f.label.trim(),
      p_icon: f.icon || null,
      p_color: null,
      p_sort: Number(f.sort) || 100,
      p_has_end: f.has_end,
      p_due_after_min: f.due_after_min === "" ? null : Number(f.due_after_min),
      p_fields: fields,
      p_show_on_home: f.show_on_home,
      p_is_active: f.is_active,
    });
    setBusy(false);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    setF(blank);
    router.refresh();
  }
  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={save} className="card flex flex-col gap-3">
        <h2 className="font-semibold">{f.id ? `Change ${f.id}` : "New entry type"}</h2>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Log</span>
            <select className="input" value={f.module_id} disabled={!!f.id} onChange={(e) => setF({ ...f, module_id: e.target.value })}>
              {modules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Key</span>
            <input className="input" required pattern="[a-z][a-z0-9_]*" value={f.key} disabled={!!f.id} onChange={(e) => setF({ ...f, key: e.target.value })} placeholder="bath" />
          </label>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Label</span>
            <input className="input" required maxLength={40} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Icon</span>
            <input className="input w-20 text-center" maxLength={4} value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Order</span>
            <input className="input" type="number" value={f.sort} onChange={(e) => setF({ ...f, sort: Number(e.target.value) })} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Due again after (minutes)</span>
            <input className="input" type="number" min={0} value={f.due_after_min} onChange={(e) => setF({ ...f, due_after_min: e.target.value })} placeholder="blank = never" />
          </label>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="h-5 w-5" style={{ minHeight: 0 }} checked={f.has_end} onChange={(e) => setF({ ...f, has_end: e.target.checked })} /> Has a start and an end
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="h-5 w-5" style={{ minHeight: 0 }} checked={f.show_on_home} onChange={(e) => setF({ ...f, show_on_home: e.target.checked })} /> Show on the home screen
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="h-5 w-5" style={{ minHeight: 0 }} checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> Switched on
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold">Fields (JSON list)</span>
          <textarea className="input font-mono text-xs" rows={6} value={f.fields} onChange={(e) => setF({ ...f, fields: e.target.value })} />
          <span className="muted">
            Each field: {"{"}&quot;key&quot;, &quot;label&quot;, &quot;type&quot; (choice, number, text, date), &quot;options&quot; for a choice, &quot;quick&quot; for number buttons, &quot;required&quot;, &quot;default&quot;{"}"}.
          </span>
        </label>
        {msg && <p className="notice notice-danger">{msg}</p>}
        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary grow" disabled={busy}>
            <Icon name="check" size={18} /> Save
          </button>
          {f.id && (
            <button type="button" className="btn" onClick={() => setF(blank)}>
              Cancel
            </button>
          )}
        </div>
      </form>
      {modules.map((m) => (
        <section key={m.id} className="card">
          <h2 className="font-semibold">{m.label}</h2>
          <ul className="flex flex-col">
            {types
              .filter((t) => t.module_id === m.id)
              .map((t) => (
                <li key={t.id} className={`row ${t.is_active ? "" : "opacity-50"}`}>
                  <span className="w-8 text-center" aria-hidden>
                    {t.icon}
                  </span>
                  <span className="grow">
                    <span className="font-semibold">{t.label}</span>
                    <span className="muted text-sm">
                      {" "}
                      · {t.key}
                      {t.due_after_min ? ` · due after ${t.due_after_min} min` : ""}
                      {t.has_end ? " · timed" : ""}
                      {t.is_active ? "" : " · off"}
                    </span>
                  </span>
                  <button type="button" className="btn" style={{ minHeight: 40 }} onClick={() => edit(t)}>
                    Edit
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
