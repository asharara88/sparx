import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

/** One notification to one member, on every phone they switched it on. Never sent twice for the same key. */
export interface Notice {
  kind: string;
  key: string;
  title: string;
  body?: string;
  url?: string;
}

let configured = false;
export function pushConfigured(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}
function setup() {
  if (configured) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:home@example.com", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  configured = true;
}

interface Sub {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Returns how many phones got it. 0 with `skipped: "sent"` when the key was already sent,
 * `skipped: "no_phones"` when the member has no active subscription.
 */
export async function notifyMember(service: SupabaseClient, memberId: string, n: Notice): Promise<{ sent: number; skipped?: "sent" | "no_phones" | "not_configured" }> {
  if (!pushConfigured()) return { sent: 0, skipped: "not_configured" };
  setup();
  // Dedupe first: the unique (member_id, key) is the lock.
  const { data: ins, error: insErr } = await service
    .from("notifications")
    .insert({ member_id: memberId, kind: n.kind, key: n.key, title: n.title, body: n.body ?? null, url: n.url ?? null })
    .select("id")
    .maybeSingle();
  if (insErr || !ins) return { sent: 0, skipped: "sent" };

  const { data: subs } = await service.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("member_id", memberId).eq("is_active", true);
  const list = (subs as Sub[] | null) ?? [];
  if (list.length === 0) {
    await service.from("notifications").update({ result: { phones: 0 } }).eq("id", ins.id);
    return { sent: 0, skipped: "no_phones" };
  }
  const payload = JSON.stringify({ title: n.title, body: n.body ?? "", url: n.url ?? "/", tag: n.kind });
  let sent = 0;
  const results: Record<string, string> = {};
  for (const s of list) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 6 * 3600, urgency: "normal" });
      sent += 1;
      results[s.id] = "ok";
      await service.from("push_subscriptions").update({ last_ok_at: new Date().toISOString() }).eq("id", s.id);
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      results[s.id] = `error ${status ?? ""}`.trim();
      // 404 / 410: the phone unsubscribed or the browser dropped it; stop trying.
      if (status === 404 || status === 410) await service.from("push_subscriptions").update({ is_active: false, failed_at: new Date().toISOString() }).eq("id", s.id);
      else await service.from("push_subscriptions").update({ failed_at: new Date().toISOString() }).eq("id", s.id);
    }
  }
  await service.from("notifications").update({ result: { phones: list.length, sent, results } }).eq("id", ins.id);
  return { sent };
}

/** Strip the assistant's citation markers for a notification body. */
export function plain(text: string, max = 160): string {
  const t = text
    .replace(/\[(entry|event|ticket|item):[^\]]+\]/g, "")
    .replace(/\*\*/g, "")
    .replace(/^[-•*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}
