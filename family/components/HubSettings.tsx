"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { HubEntity, HubState, RpcError } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Admin: choose which Home Assistant entities the house shows. Read-only hub; nothing here controls anything. */
export function HubSettings({ configured }: { configured: HubEntity[] }) {
  const router = useRouter();
  const [all, setAll] = useState<HubState[] | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "off" | "error">("loading");
  const [msg, setMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const shown = new Map(configured.map((c) => [c.entity_id, c]));

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/hub/states?all=1");
        const out = (await r.json()) as { ok: true; states: HubState[] } | RpcError;
        if (!out.ok) {
          setState(out.error === "not_configured" ? "off" : "error");
          setMsg(out.message ?? null);
          return;
        }
        setAll(out.states);
        setState("ok");
      } catch {
        setState("error");
      }
    })();
  }, []);

  async function save(s: HubState, active: boolean, label?: string) {
    setBusy(s.entity_id);
    const kind = s.entity_id.startsWith("camera.") ? "camera" : s.entity_id.startsWith("binary_sensor.") ? "binary" : s.entity_id.startsWith("sensor.") ? "sensor" : "other";
    const { data, error } = await supabaseBrowser().rpc("hub_entity_save", { p_entity_id: s.entity_id, p_label: label ?? shown.get(s.entity_id)?.label ?? s.label, p_kind: kind, p_sort: shown.get(s.entity_id)?.sort ?? 100, p_is_active: active });
    setBusy(null);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    router.refresh();
  }

  if (state === "off") return <p className="card">No hub connected. Set <code>HOME_ASSISTANT_URL</code> and <code>HOME_ASSISTANT_TOKEN</code> (a long-lived access token from a read-only Home Assistant user) on the Vercel project, redeploy, and come back.</p>;
  if (state === "error") return <p className="card text-[var(--danger)]">Could not reach the hub: {msg}</p>;
  if (state === "loading" || !all) return <p className="muted">Reading the hub…</p>;
  const q = filter.trim().toLowerCase();
  const rows = all.filter((s) => !q || s.entity_id.includes(q) || s.label.toLowerCase().includes(q)).slice(0, 200);
  return (
    <div className="flex flex-col gap-3">
      <p className="muted text-sm">Tick what the house screen should show. Sensors, door and motion states, and camera stills. The app never switches anything.</p>
      <input className="input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find an entity (temperature, door, camera…)" aria-label="Find" />
      {msg && <p className="text-sm text-[var(--danger)]">{msg}</p>}
      <ul className="flex flex-col gap-1">
        {rows.map((s) => {
          const on = shown.has(s.entity_id) && shown.get(s.entity_id)!.is_active;
          return (
            <li key={s.entity_id} className="flex items-center gap-3 border-b border-[var(--line)] py-1">
              <input type="checkbox" className="h-7 w-7" checked={on} onChange={(e) => save(s, e.target.checked)} disabled={busy === s.entity_id} aria-label={`Show ${s.label}`} />
              <span className="flex-1">
                <span className="block font-semibold">{shown.get(s.entity_id)?.label ?? s.label}</span>
                <span className="muted block text-xs">
                  {s.entity_id} · {s.state}
                  {s.unit ? ` ${s.unit}` : ""}
                </span>
              </span>
              {on && (
                <button type="button" className="btn" style={{ minHeight: 40, padding: "4px 10px" }} onClick={() => {
                  const label = prompt("Label", shown.get(s.entity_id)?.label ?? s.label);
                  if (label) void save(s, true, label);
                }}>
                  Rename
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {rows.length === 200 && <p className="muted text-sm">Showing the first 200. Narrow it down.</p>}
    </div>
  );
}
