"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { uploadPhoto } from "@/lib/photos";
import { fmtDate, fmtTime } from "@/lib/time";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { Photo } from "./Photo";

/**
 * One shared stream for the whole house: short messages and photos. Polls every
 * few seconds while the tab is visible, so a photo the home carer posts shows up on
 * a parent's phone without a refresh. Anyone deletes their own; admins delete any.
 */
export function FamilyChat({ initial, timezone, canPost }: { initial: ChatMessage[]; timezone: string; canPost: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const { data } = await supabaseBrowser().rpc("chat_list", { p_limit: 150 });
    const d = data as { ok: boolean; messages?: ChatMessage[] } | null;
    if (d?.ok && d.messages) setMessages(d.messages);
  }, []);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const t = setInterval(tick, 5000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh]);

  const lastId = messages[messages.length - 1]?.id;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lastId]);

  async function send(photo?: File) {
    const body = text.trim();
    if (!body && !photo) return;
    setBusy(true);
    setMsg(null);
    try {
      const path = photo ? await uploadPhoto(photo, "chat") : null;
      const { data, error } = await supabaseBrowser().rpc("chat_send", { p_body: body, p_photo_path: path });
      const r = data as { ok: boolean; message?: string } | null;
      if (error || !r?.ok) throw new Error(r?.message ?? error?.message ?? "Not sent.");
      setText("");
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Not sent. Please try again.");
    } finally {
      setBusy(false);
      if (cameraRef.current) cameraRef.current.value = "";
      if (libraryRef.current) libraryRef.current.value = "";
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this message?")) return;
    const { data } = await supabaseBrowser().rpc("chat_remove", { p_id: id });
    const r = data as { ok: boolean; message?: string } | null;
    if (!r?.ok) {
      setMsg(r?.message ?? "Could not delete.");
      return;
    }
    setMessages((m) => m.filter((x) => x.id !== id));
  }

  let lastDay = "";
  return (
    <>
      <ol className="flex flex-1 flex-col gap-2 overflow-y-auto px-1 pb-2" aria-live="polite" aria-label="Messages">
        {messages.length === 0 && <li className="card-flat muted text-center">No messages yet. Say hello, or send a photo.</li>}
        {messages.map((m) => {
          const day = fmtDate(m.created_at, timezone, { weekday: "short", day: "numeric", month: "short" });
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <li key={m.id} className="flex flex-col gap-2">
              {showDay && <p className="muted my-1 text-center text-xs font-semibold uppercase tracking-wide">{day}</p>}
              <div className={`flex items-end gap-2 ${m.mine ? "flex-row-reverse" : ""}`}>
                {!m.mine && <Avatar name={m.author_name} path={m.author_photo} size={32} className="shrink-0" />}
                <div className={`chat-bubble ${m.mine ? "chat-bubble-mine" : ""}`}>
                  {!m.mine && <p className="chat-author">{m.author_name}</p>}
                  {m.photo_path && (
                    <button type="button" className="block" onClick={() => setOpen(m.photo_path)} aria-label="Open photo">
                      <Photo path={m.photo_path} alt={`Photo from ${m.author_name}`} className="chat-photo" />
                    </button>
                  )}
                  {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                  <p className="chat-meta">
                    <span>{fmtTime(m.created_at, timezone)}</span>
                    <button type="button" className="chat-delete" onClick={() => remove(m.id)} aria-label="Delete message">
                      <Icon name="x" size={14} />
                    </button>
                  </p>
                </div>
              </div>
            </li>
          );
        })}
        <div ref={endRef} />
      </ol>

      {msg && (
        <p role="alert" className="notice notice-danger">
          {msg}
        </p>
      )}

      {canPost && (
        <form
          className="chat-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void send(e.target.files?.[0])} />
          <input ref={libraryRef} type="file" accept="image/*" className="hidden" onChange={(e) => void send(e.target.files?.[0])} />
          <button type="button" className="icon-btn" aria-label="Take a photo" disabled={busy} onClick={() => cameraRef.current?.click()}>
            <Icon name="camera" size={22} />
          </button>
          <button type="button" className="icon-btn" aria-label="Choose a photo" disabled={busy} onClick={() => libraryRef.current?.click()}>
            <Icon name="grid" size={22} />
          </button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Write a message"
            rows={1}
            maxLength={2000}
            className="input flex-1 resize-none"
            aria-label="Message"
            disabled={busy}
          />
          <button type="submit" className="btn btn-primary" aria-label="Send" disabled={busy || !text.trim()}>
            <Icon name="send" size={20} />
          </button>
        </form>
      )}

      {open && (
        <div className="lightbox" role="dialog" aria-label="Photo" onClick={() => setOpen(null)}>
          <Photo path={open} alt="" className="lightbox-img" />
          <button type="button" className="btn btn-secondary mt-3" onClick={() => setOpen(null)}>
            Close
          </button>
        </div>
      )}
    </>
  );
}
