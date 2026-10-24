"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { joinPath } from "@/lib/join";
import { Icon } from "./Icon";

import type { AccountState } from "@/lib/accounts";

/**
 * One tap makes (or reuses) the member's invite link and hands it to the phone's share
 * sheet, else copies it. Whoever opens the link and signs in, with any e-mail, becomes
 * this member (migration 5300). Good for seven days.
 */
export function InviteLink({ memberId, name, state }: { memberId: string; name: string; state: AccountState | undefined }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("member_invite_create", { p_member_id: memberId });
    const res = data as { ok: boolean; token?: string; message?: string } | null;
    if (error || !res?.ok || !res.token) {
      setBusy(false);
      return setMsg(res?.message ?? error?.message ?? "Could not make the link.");
    }
    const url = `${window.location.origin}${joinPath(res.token)}`;
    const text = `Join our home on elnunu as ${name}: ${url}`;
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void> };
    try {
      if (nav.share) {
        await nav.share({ title: "Join our home on elnunu", text, url });
        setMsg("Sent. The link works for seven days.");
      } else {
        await navigator.clipboard.writeText(url);
        setMsg("Link copied. Send it to them; it works for seven days.");
      }
    } catch {
      // The share sheet was closed, or the clipboard refused: show the link itself.
      setMsg(url);
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-1">
      <button type="button" className="btn w-full" style={{ minHeight: 44 }} onClick={send} disabled={busy}>
        <Icon name="send" size={18} /> {busy ? "One moment…" : state === "signed_in" ? "Send a link to this home" : "Send an invite link"}
      </button>
      {msg && (
        <p role="status" className={`notice ${msg.startsWith("http") ? "" : msg.startsWith("Could") ? "notice-danger" : "notice-ok"} break-all text-sm`}>
          {msg}
        </p>
      )}
    </div>
  );
}
