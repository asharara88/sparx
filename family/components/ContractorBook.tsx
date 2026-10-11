"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Contractor } from "@/lib/types";
import { can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { supabaseBrowser } from "@/lib/supabase/client";

const EMPTY = { name: "", trade: "", phone: "", whatsapp: "", company: "", notes: "", rating: "" };

export function ContractorBook({ contractors }: { contractors: Contractor[] }) {
  const me = useMe();
  const router = useRouter();
  const canEdit = can(me, "maintenance", "edit");
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function start(c: Contractor | null) {
    setEditing(c ? c.id : "new");
    setForm(c ? { name: c.name, trade: c.trade ?? "", phone: c.phone ?? "", whatsapp: c.whatsapp ?? "", company: c.company ?? "", notes: c.notes ?? "", rating: c.rating ? String(c.rating) : "" } : EMPTY);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("contractor_save", {
      p_id: editing === "new" ? null : editing,
      p_name: form.name,
      p_trade: form.trade || null,
      p_phone: form.phone || null,
      p_whatsapp: form.whatsapp || null,
      p_company: form.company || null,
      p_notes: form.notes || null,
      p_rating: form.rating ? Number(form.rating) : null,
      p_is_active: true,
    });
    setBusy(false);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    setEditing(null);
    router.refresh();
  }
  async function remove(c: Contractor) {
    if (!confirm(`Remove ${c.name} from the book?`)) return;
    await supabaseBrowser().rpc("contractor_save", { p_id: c.id, p_name: c.name, p_trade: c.trade, p_phone: c.phone, p_whatsapp: c.whatsapp, p_company: c.company, p_notes: c.notes, p_rating: c.rating, p_is_active: false });
    router.refresh();
  }
  const tel = (s: string) => s.replace(/\s/g, "");

  return (
    <div className="flex flex-col gap-3">
      {canEdit && editing === null && (
        <button type="button" className="btn btn-primary" onClick={() => start(null)}>
          + Add a contractor
        </button>
      )}
      {editing !== null && (
        <form onSubmit={save} className="card flex flex-col gap-2">
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" aria-label="Name" required />
          <input className="input" value={form.trade} onChange={(e) => setForm({ ...form, trade: e.target.value })} placeholder="Trade (AC, plumbing, electrician…)" aria-label="Trade" />
          <input className="input" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone" aria-label="Phone" />
          <input className="input" type="tel" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} placeholder="WhatsApp (if different)" aria-label="WhatsApp" />
          <input className="input" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Company" aria-label="Company" />
          <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes (good at…, prices, hours)" aria-label="Notes" />
          <div className="flex flex-wrap gap-2" role="group" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((r) => (
              <button key={r} type="button" className="chip" aria-pressed={form.rating === String(r)} onClick={() => setForm({ ...form, rating: form.rating === String(r) ? "" : String(r) })}>
                {"★".repeat(r)}
              </button>
            ))}
          </div>
          {msg && <p className="text-red-800">{msg}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn" onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}
      {contractors.length === 0 && editing === null && <p className="muted card">Nobody in the book yet. Add the AC people, the plumber, the electrician.</p>}
      <ul className="flex flex-col gap-2">
        {contractors.map((c) => (
          <li key={c.id} className="card">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-lg font-bold">
                  {c.name}
                  {c.trade ? <span className="muted font-normal"> · {c.trade}</span> : null}
                </p>
                {c.company && <p className="muted text-sm">{c.company}</p>}
                {c.rating ? <p className="text-sm text-amber-600">{"★".repeat(c.rating)}</p> : null}
                {c.notes && <p className="mt-1 text-sm">{c.notes}</p>}
                <p className="muted text-sm">
                  {c.jobs} {c.jobs === 1 ? "job" : "jobs"}
                </p>
              </div>
              {canEdit && (
                <div className="flex flex-col gap-1">
                  <button type="button" className="btn" onClick={() => start(c)}>
                    Edit
                  </button>
                  <button type="button" className="btn" onClick={() => remove(c)}>
                    Remove
                  </button>
                </div>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {c.phone && (
                <a className="btn" href={`tel:${tel(c.phone)}`}>
                  📞 Call
                </a>
              )}
              {(c.whatsapp || c.phone) && (
                <a className="btn" href={`https://wa.me/${tel(c.whatsapp || c.phone!).replace(/^\+/, "").replace(/^00/, "")}`} target="_blank" rel="noreferrer">
                  💬 WhatsApp
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
