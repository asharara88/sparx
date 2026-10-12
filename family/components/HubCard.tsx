"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { HubState, RpcError } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { can } from "@/lib/types";
import { ago } from "@/lib/time";

/** The house's sensors and cameras, read from Home Assistant. Hidden until a hub is connected. */
export function HubCard() {
  const me = useMe();
  const [states, setStates] = useState<HubState[] | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "off" | "error">("loading");
  const [msg, setMsg] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const admin = can(me, "members", "edit");

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await fetch("/api/hub/states");
        const out = (await r.json()) as { ok: true; states: HubState[]; configured: number } | RpcError;
        if (!live) return;
        if (!out.ok) {
          setState(out.error === "not_configured" ? "off" : "error");
          setMsg(out.message ?? null);
          return;
        }
        setStates(out.states);
        setState("ok");
      } catch {
        if (live) setState("error");
      }
    })();
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [tick]);

  if (state === "loading") return null;
  if (state === "off") return admin ? <p className="muted text-sm">No smart-home hub connected. Set HOME_ASSISTANT_URL and HOME_ASSISTANT_TOKEN on the server, then pick entities under “Hub”.</p> : null;
  if (state === "error") return admin ? <p className="text-sm text-[var(--danger)]">Hub: {msg ?? "could not reach it"}.</p> : null;
  const list = states ?? [];
  if (list.length === 0) return admin ? <p className="muted text-sm"><Link href="/house/hub" className="underline">Pick which sensors and cameras to show.</Link></p> : null;
  const cams = list.filter((s) => s.kind === "camera");
  const rest = list.filter((s) => s.kind !== "camera");
  return (
    <section className="card" aria-labelledby="hub-h">
      <div className="flex items-baseline justify-between">
        <h2 id="hub-h" className="text-xl font-semibold">
          Around the house
        </h2>
        {admin && (
          <Link href="/house/hub" className="text-sm font-semibold text-[var(--accent)]">
            Hub ›
          </Link>
        )}
      </div>
      {rest.length > 0 && (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
          {rest.map((s) => (
            <div key={s.entity_id} className="contents">
              <dt className="muted">{s.label}</dt>
              <dd className="font-semibold">
                {s.kind === "binary" ? (s.state === "on" ? "On" : s.state === "off" ? "Off" : s.state) : `${s.state}${s.unit ? ` ${s.unit}` : ""}`}
                {s.last_changed && <span className="muted text-xs"> · {ago(s.last_changed)}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {cams.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {cams.map((c) => (
            <figure key={c.entity_id}>
              <img src={`/api/hub/camera/${encodeURIComponent(c.entity_id)}?t=${tick}`} alt={c.label} className="h-32 w-full rounded-xl object-cover" />
              <figcaption className="muted text-xs">{c.label}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}
