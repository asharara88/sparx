"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Asset, Contractor, TicketDetail as TicketDetailData, TicketStatus } from "@/lib/types";
import { TICKET_STATUS, can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { fmtDateTime } from "@/lib/time";
import { supabaseBrowser } from "@/lib/supabase/client";
import { uploadPhoto } from "@/lib/photos";
import { Photo } from "./Photo";
import { PhotoPicker } from "./PhotoPicker";

export function TicketDetail({ data, assets, contractors, timezone }: { data: TicketDetailData; assets: Asset[]; contractors: Contractor[]; timezone: string }) {
  const me = useMe();
  const router = useRouter();
  const t = data.ticket;
  const canEdit = can(me, "maintenance", "edit");
  const canCost = can(me, "maintenance_costs", "add");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [costNote, setCostNote] = useState("");
  const status = TICKET_STATUS.find((s) => s.id === t.status)!;

  async function update(args: { p_note?: string | null; p_status?: TicketStatus | null; p_photo_path?: string | null; p_contractor_id?: string | null; p_asset_id?: string | null; p_priority?: string | null }) {
    setBusy(true);
    setMsg(null);
    const { data: d, error } = await supabaseBrowser().rpc("ticket_update", {
      p_id: t.id,
      p_note: args.p_note ?? null,
      p_status: args.p_status ?? null,
      p_photo_path: args.p_photo_path ?? null,
      p_contractor_id: args.p_contractor_id ?? null,
      p_asset_id: args.p_asset_id ?? null,
      p_priority: args.p_priority ?? null,
      p_location: null,
    });
    setBusy(false);
    const res = d as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not update.");
    router.refresh();
  }
  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim() && !file) return;
    try {
      const path = file ? await uploadPhoto(file, "tickets") : null;
      await update({ p_note: note.trim() || null, p_photo_path: path });
      setNote("");
      setFile(null);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not upload the photo.");
    }
  }
  async function addCost(e: React.FormEvent) {
    e.preventDefault();
    if (!amount) return;
    setBusy(true);
    const { data: d, error } = await supabaseBrowser().rpc("ticket_cost_add", { p_ticket_id: t.id, p_amount: Number(amount), p_note: costNote || null, p_paid_on: new Date().toISOString().slice(0, 10), p_paid_by: me.member.id });
    setBusy(false);
    const res = d as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not add the cost.");
    setAmount("");
    setCostNote("");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3 pt-2">
        <Link href="/house" className="btn" aria-label="Back">
          ‹
        </Link>
        <h1 className="text-2xl font-bold">
          {t.priority === "urgent" ? "🔥 " : ""}
          {t.title}
        </h1>
      </header>

      <section className="card">
        <p className="text-lg">
          {status.icon} <b>{status.label}</b>
          {t.location ? ` · ${t.location}` : ""}
          {t.asset_name ? ` · ${t.asset_name}` : ""}
        </p>
        <p className="muted text-sm">
          Opened {fmtDateTime(t.created_at, timezone)}
          {t.opened_by_name ? ` by ${t.opened_by_name}` : ""}
          {t.closed_at ? ` · closed ${fmtDateTime(t.closed_at, timezone)}` : ""}
        </p>
        {t.description && <p className="mt-2 whitespace-pre-wrap">{t.description}</p>}
        {t.contractor_name && (
          <p className="mt-2">
            🔧 {t.contractor_name}
            {t.contractor_phone ? (
              <>
                {" · "}
                <a className="underline" href={`tel:${t.contractor_phone.replace(/\s/g, "")}`}>
                  {t.contractor_phone}
                </a>
              </>
            ) : null}
          </p>
        )}
        {canEdit && (
          <div className="mt-3 flex flex-col gap-2">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Status">
              {TICKET_STATUS.map((s) => (
                <button key={s.id} type="button" className="chip" aria-pressed={t.status === s.id} disabled={busy || t.status === s.id} onClick={() => update({ p_status: s.id })}>
                  {s.icon} {s.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <select className="input" value={t.contractor_id ?? ""} onChange={(e) => e.target.value && update({ p_contractor_id: e.target.value })} aria-label="Contractor" disabled={busy}>
                <option value="">Assign a contractor…</option>
                {contractors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.trade ? ` · ${c.trade}` : ""}
                  </option>
                ))}
              </select>
              <select className="input" value={t.asset_id ?? ""} onChange={(e) => e.target.value && update({ p_asset_id: e.target.value })} aria-label="Appliance" disabled={busy}>
                <option value="">Which appliance…</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.location ? ` · ${a.location}` : ""}
                  </option>
                ))}
              </select>
            </div>
            {t.priority !== "urgent" && (
              <button type="button" className="btn" onClick={() => update({ p_priority: "urgent" })} disabled={busy}>
                🔥 Mark urgent
              </button>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="font-semibold">What happened</h2>
        <ol className="mt-2 flex flex-col gap-3">
          {data.updates.map((u) => (
            <li key={u.id} className="border-l-4 border-[var(--line)] pl-3">
              <p className="muted text-sm">
                {fmtDateTime(u.created_at, timezone)}
                {u.by_name ? ` · ${u.by_name}` : ""}
                {u.status ? ` · ${TICKET_STATUS.find((s) => s.id === u.status)?.label}` : ""}
              </p>
              {u.note && <p className="whitespace-pre-wrap">{u.note}</p>}
              {u.photo_path && <Photo path={u.photo_path} alt="" className="mt-1 h-40 w-full max-w-xs" />}
            </li>
          ))}
        </ol>
        <form onSubmit={addNote} className="mt-3 flex flex-col gap-2">
          <PhotoPicker label="Add a photo" file={file} onFile={setFile} disabled={busy} />
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note" aria-label="Note" />
          <button type="submit" className="btn" disabled={busy || (!note.trim() && !file)}>
            {busy ? "Saving…" : "Add"}
          </button>
        </form>
      </section>

      {data.costs_visible && (
        <section className="card">
          <h2 className="font-semibold">Costs</h2>
          {(data.costs ?? []).length === 0 ? (
            <p className="muted mt-1">Nothing paid yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {(data.costs ?? []).map((c) => (
                <li key={c.id} className="flex justify-between">
                  <span>
                    {c.note ?? "Paid"}
                    {c.paid_by_name ? ` · ${c.paid_by_name}` : ""}
                    {c.paid_on ? ` · ${c.paid_on}` : ""}
                  </span>
                  <b>
                    {c.amount} {c.currency}
                  </b>
                </li>
              ))}
              <li className="flex justify-between border-t border-[var(--line)] pt-1">
                <span>Total</span>
                <b>
                  {(data.costs ?? []).reduce((a, c) => a + Number(c.amount), 0)} {(data.costs ?? [])[0]?.currency}
                </b>
              </li>
            </ul>
          )}
          {canCost && (
            <form onSubmit={addCost} className="mt-3 grid grid-cols-[1fr_2fr_auto] gap-2">
              <input className="input" type="number" inputMode="decimal" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" aria-label="Amount" />
              <input className="input" value={costNote} onChange={(e) => setCostNote(e.target.value)} placeholder="What for" aria-label="What for" />
              <button type="submit" className="btn" disabled={busy || !amount}>
                Add
              </button>
            </form>
          )}
        </section>
      )}

      {msg && (
        <p role="alert" className="rounded-xl border-2 border-red-700 p-3 text-red-800">
          {msg}
        </p>
      )}
    </div>
  );
}
