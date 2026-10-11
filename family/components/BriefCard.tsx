"use client";
import { useEffect, useState } from "react";
import type { Brief, RpcError } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { Cited } from "./Cited";

/**
 * This morning's brief (from 06:00) or this evening's digest (from 17:00), written
 * once per member per day the first time the screen is opened, then kept.
 */
export function BriefCard({ hour }: { hour: number }) {
  const me = useMe();
  const kind: "morning" | "evening" | null = hour >= 17 ? "evening" : hour >= 6 ? "morning" : null;
  const [brief, setBrief] = useState<Brief | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error" | "off">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  async function load(refresh = false) {
    if (!kind) return;
    setState("loading");
    setMsg(null);
    try {
      const res = await fetch(`/api/assistant/brief?kind=${kind}${refresh ? "&refresh=1" : ""}`);
      const data = (await res.json()) as { ok: true; brief: Brief } | RpcError;
      if (!data.ok) {
        setState(data.error === "not_configured" || data.error === "not_allowed" ? "off" : "error");
        setMsg(data.message ?? null);
        return;
      }
      setBrief(data.brief);
      setState("idle");
    } catch {
      setState("error");
      setMsg("No connection.");
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  if (!kind) return null;
  if (state === "off") {
    // Not set up (no API key) or not allowed for this role: admins see why, others see nothing.
    return me.role.id === "admin" ? <p className="muted text-sm">Brief off: {msg}</p> : null;
  }
  return (
    <section className="card" aria-labelledby="brief-h">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="brief-h" className="text-xl font-semibold">
          {kind === "morning" ? "This morning" : "Today, in short"}
        </h2>
        <button type="button" className="text-sm font-semibold text-[var(--accent)]" onClick={() => void load(true)} disabled={state === "loading"}>
          {state === "loading" ? "Writing…" : brief ? "Write it again" : "Write it"}
        </button>
      </div>
      {state === "loading" && !brief && <p className="muted mt-2">Reading the night's log…</p>}
      {state === "error" && <p className="mt-2 text-red-800">{msg ?? "Could not write the brief."}</p>}
      {brief && (
        <div className="mt-2">
          <Cited text={brief.content} refs={brief.refs} />
        </div>
      )}
    </section>
  );
}
