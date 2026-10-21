"use client";
import { useEffect, useState } from "react";
import type { Brief, RpcError } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { childPronouns } from "@/lib/names";
import { Cited } from "./Cited";

/**
 * "This week for <child>": what the age usually brings this week, how last week
 * went, what is due. Written once a week per member (the Sunday push writes it
 * early); "Write it again" refreshes.
 */
export function WeekCard({ name }: { name: string }) {
  const me = useMe();
  const pr = childPronouns(me);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error" | "off">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  async function load(refresh = false) {
    setState("loading");
    setMsg(null);
    try {
      const res = await fetch(`/api/assistant/brief?kind=week${refresh ? "&refresh=1" : ""}`);
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
  }, []);

  if (state === "off") return me.role.id === "admin" ? <p className="muted px-1 text-sm">The weekly note is off. {msg}</p> : null;
  return (
    <section className="card" aria-labelledby="week-h">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="week-h" className="text-xl font-semibold">
          This week for {name}
        </h2>
        <button type="button" className="text-sm font-semibold text-[var(--accent)]" onClick={() => void load(true)} disabled={state === "loading"}>
          {state === "loading" ? "Writing…" : brief ? "Write it again" : "Write it"}
        </button>
      </div>
      {state === "loading" && !brief && <p className="muted mt-2">Looking at {pr.their} age and last week…</p>}
      {state === "error" && <p className="mt-2 text-sm text-[var(--warn)]">{(msg ?? "Could not write it.").slice(0, 200)}</p>}
      {brief && (
        <div className="mt-2">
          <Cited text={brief.content} refs={brief.refs} />
          <p className="muted mt-2 text-xs">From {pr.their} log and the week {pr.they} {pr.is} at. General guidance, not medical advice.</p>
        </div>
      )}
    </section>
  );
}
