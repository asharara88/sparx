"use client";
import { useEffect, useState } from "react";
import type { PushStatus } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtDateTime } from "@/lib/time";
import { useMe } from "@/lib/me-context";

const KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function toKey(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Push notifications on this phone: the morning brief, things to approve, reminders. The page's header says what they are. */
export function NotificationsToggle() {
  const me = useMe();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [here, setHere] = useState<"unknown" | "on" | "off" | "unsupported" | "blocked">("unknown");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // An iPhone browser tab (not the app on the Home Screen) cannot get them yet. Read after
  // the first render, so the server's page and the phone's first render are the same.
  const [iosTab, setIosTab] = useState(false);
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    setIosTab(/iPhone|iPad/.test(navigator.userAgent) && !standalone);
  }, []);

  async function load() {
    const { data } = await supabaseBrowser().rpc("push_status");
    if ((data as PushStatus | null)?.ok) setStatus(data as PushStatus);
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !KEY) return setHere("unsupported");
    if (Notification.permission === "denied") return setHere("blocked");
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    setHere(sub ? "on" : "off");
  }
  useEffect(() => {
    void load();
  }, []);

  async function turnOn() {
    setBusy(true);
    setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setHere(perm === "denied" ? "blocked" : "off");
        return setMsg("Notifications were not allowed on this phone.");
      }
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(KEY) as BufferSource });
      const json = sub.toJSON();
      const { data, error } = await supabaseBrowser().rpc("push_subscribe", { p_endpoint: sub.endpoint, p_p256dh: json.keys?.p256dh, p_auth: json.keys?.auth, p_user_agent: navigator.userAgent });
      const res = data as { ok: boolean; message?: string } | null;
      if (error || !res?.ok) {
        // Not on the server, so nothing would ever arrive: drop the phone's half too, or the
        // next load would read the phone's subscription and show "on".
        await sub.unsubscribe().catch(() => false);
        throw new Error(res?.message ?? error?.message ?? "Could not save.");
      }
      setHere("on");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not switch notifications on.");
    } finally {
      setBusy(false);
    }
  }
  async function turnOff() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await supabaseBrowser().rpc("push_unsubscribe", { p_endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setHere("off");
      await load();
    } finally {
      setBusy(false);
    }
  }

  const iosFirst = iosTab && here !== "on";
  // Nothing known yet (the first moment on the page): no empty white box under the header.
  if (here === "unknown" && !status && !msg && !iosFirst) return null;

  return (
    <div className="card flex flex-col gap-3">
      {here === "unsupported" && <p>{KEY ? "This browser cannot receive notifications." : "Notifications are not set up on the server yet."}</p>}
      {here === "blocked" && <p>Notifications are blocked for this site. Allow them in the phone's settings, then come back.</p>}
      {iosFirst && <p className="text-sm">On iPhone, first add the app to the Home Screen (Share → Add to Home Screen) and open it from there; then switch notifications on.</p>}
      {(here === "off" || here === "on") && (
        <div className="flex flex-wrap gap-2">
          {here === "off" && (
            <button type="button" className="btn btn-primary" onClick={turnOn} disabled={busy}>
              {busy ? "…" : "Turn on on this phone"}
            </button>
          )}
          {here === "on" && (
            <button type="button" className="btn" onClick={turnOff} disabled={busy}>
              {busy ? "…" : "Turn off on this phone"}
            </button>
          )}
        </div>
      )}
      {msg && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {msg}
        </p>
      )}
      {status && (
        <p className="muted text-sm">
          {status.phones === 0 ? "No phone has them on yet." : `${status.phones} ${status.phones === 1 ? "phone has" : "phones have"} them on.`}
          {status.recent.length > 0 ? ` Last: ${status.recent[0].title} (${fmtDateTime(status.recent[0].sent_at, me.household.timezone)})` : ""}
        </p>
      )}
    </div>
  );
}
