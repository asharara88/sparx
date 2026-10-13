"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MilkReading, RpcError } from "@/lib/types";
import { downscale } from "@/lib/photos";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Icon } from "@/components/Icon";

/**
 * Point the camera at a bag label or a bottle; the amount, date and morning/night
 * come back filled in. Check them, pick fridge or freezer, tap Add.
 */
export function MilkScan({ timezone }: { timezone: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState<MilkReading | null>(null);
  const [ml, setMl] = useState<number | "">("");
  const [date, setDate] = useState("");
  const [source, setSource] = useState<"morning" | "night" | "">("");
  const [where, setWhere] = useState<"fridge" | "freezer">("freezer");
  const [msg, setMsg] = useState<string | null>(null);

  async function pick(file: File | null) {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    setReading(null);
    try {
      const blob = await downscale(file, 1280);
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(new Error("Could not read the photo."));
        r.readAsDataURL(blob);
      });
      const res = await fetch("/api/milk/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: dataUrl }) });
      const data = (await res.json()) as ({ ok: true } & MilkReading) | RpcError;
      if (!data.ok) {
        setMsg(data.message ?? "Could not read the photo.");
        return;
      }
      setReading(data);
      setMl(data.ml ?? "");
      setDate(data.date ?? "");
      setSource(data.source ?? "");
      setWhere(data.kind === "bag" ? "freezer" : "fridge");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not read the photo.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function add() {
    if (!ml) return;
    setBusy(true);
    setMsg(null);
    // Pumped at: the label's date at 07:00 (morning) or 22:00 (night) in the household's clock; else now.
    let pumpedAt: string | null = null;
    if (date) {
      const hour = source === "night" ? 22 : 7;
      const probe = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);
      const local = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).format(probe);
      pumpedAt = new Date(probe.getTime() + (hour - Number(local)) * 3_600_000).toISOString();
    }
    const note = [reading?.kind === "bag" ? "bag" : null, source || null].filter(Boolean).join(" · ") || null;
    const { data, error } = await supabaseBrowser().rpc("milk_add", { p_amount_ml: Number(ml), p_location: where, p_pumped_at: pumpedAt ?? new Date().toISOString(), p_note: note });
    const res = data as { ok: boolean; message?: string } | null;
    setBusy(false);
    if (error || !res?.ok) {
      setMsg(res?.message ?? error?.message ?? "Could not save.");
      return;
    }
    setReading(null);
    setMl("");
    setDate("");
    setSource("");
    router.refresh();
  }

  return (
    <section className="card flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Read a bag or bottle</h2>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void pick(e.target.files?.[0] ?? null)} />
        <button type="button" className="btn" style={{ minHeight: 40 }} disabled={busy} onClick={() => fileRef.current?.click()}>
          <Icon name="camera" size={18} /> {busy && !reading ? "Reading…" : "Photo"}
        </button>
      </div>
      <p className="muted text-sm">Snap the handwritten label on a bag, or the scale on a bottle. The amount and date fill in; check them, then add.</p>
      {reading && (
        <div className="flex flex-col gap-2 rounded-xl bg-[var(--card-2)] p-3">
          <p className="text-sm">
            Read a <b>{reading.kind}</b>
            {reading.confidence === "low" ? " · not sure, please check" : ""}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold">Amount (ml)</span>
              <input className="input" type="number" inputMode="numeric" min={5} max={1000} value={ml} onChange={(e) => setMl(e.target.value ? Number(e.target.value) : "")} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold">Pumped on</span>
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Morning or night">
            {(["morning", "night"] as const).map((s) => (
              <button key={s} type="button" className="chip" aria-pressed={source === s} onClick={() => setSource(source === s ? "" : s)}>
                <Icon name={s === "morning" ? "sun" : "moon"} size={16} /> {s === "morning" ? "Morning" : "Night"}
              </button>
            ))}
            <span className="flex-1" />
            {(["fridge", "freezer"] as const).map((w) => (
              <button key={w} type="button" className="chip" aria-pressed={where === w} onClick={() => setWhere(w)}>
                {w === "fridge" ? "Fridge" : "Freezer"}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn" onClick={() => setReading(null)} disabled={busy}>
              Not this
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void add()} disabled={!ml || busy}>
              Add {ml ? `${ml} ml` : ""} to the {where}
            </button>
          </div>
        </div>
      )}
      {msg && (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {msg}
        </p>
      )}
    </section>
  );
}
