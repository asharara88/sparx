"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { uploadPhoto } from "@/lib/photos";
import { fmtDate, fmtTime } from "@/lib/time";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { Photo } from "./Photo";
import { Sheet } from "./Sheet";

/**
 * One shared stream for the whole house: short messages and photos. Polls every
 * few seconds while the tab is visible, so a photo the home carer posts shows up on
 * a parent's phone without a refresh. Anyone deletes their own; admins delete any: tapping
 * such a message (its words or time; the photo opens the viewer) opens a sheet with Delete,
 * armed by a second tap (DESIGN.md, rule 8). A message nobody here may delete has no control.
 */
export function FamilyChat({ initial, timezone, canPost, canDeleteAny }: { initial: ChatMessage[]; timezone: string; canPost: boolean; canDeleteAny: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [acting, setActing] = useState<ChatMessage | null>(null);
  const [armed, setArmed] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [sheetMsg, setSheetMsg] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);

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
      if (photoRef.current) photoRef.current.value = "";
    }
  }

  function act(m: ChatMessage) {
    setArmed(false);
    setSheetMsg(null);
    setActing(m);
  }
  function closeSheet() {
    setActing(null);
    setArmed(false);
    setSheetMsg(null);
  }
  async function remove(id: string) {
    // Destroying is a word and a second tap, never a pop-up.
    if (!armed) return setArmed(true);
    setRemoving(true);
    setSheetMsg(null);
    const { data, error } = await supabaseBrowser().rpc("chat_remove", { p_id: id });
    setRemoving(false);
    const r = data as { ok: boolean; message?: string } | null;
    if (error || !r?.ok) {
      setSheetMsg(r?.message ?? error?.message ?? "Could not delete.");
      return;
    }
    setMessages((m) => m.filter((x) => x.id !== id));
    closeSheet();
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
              {showDay && <p className="section-title my-1 text-center">{day}</p>}
              <div className={`flex items-end gap-2 ${m.mine ? "flex-row-reverse" : ""}`}>
                {!m.mine && <Avatar name={m.author_name} path={m.author_photo} size={32} className="shrink-0" />}
                <div className={`chat-bubble ${m.mine ? "chat-bubble-mine" : ""}`}>
                  {!m.mine && <p className="chat-author">{m.author_name}</p>}
                  {m.photo_path && (
                    <button type="button" className="block" onClick={() => setOpen(m.photo_path)} aria-label="Open photo">
                      <Photo path={m.photo_path} alt={`Photo from ${m.author_name}`} className="chat-photo" />
                    </button>
                  )}
                  {m.mine || canDeleteAny ? (
                    <>
                      {/* The words stay text you can select and copy; a plain tap on them, or the time line, opens the message's sheet. */}
                      {m.body && (
                        <p className="whitespace-pre-wrap break-words" onClick={() => { if (window.getSelection()?.isCollapsed !== false) act(m); }}>
                          {m.body}
                        </p>
                      )}
                      <button type="button" className="chat-meta min-h-[44px] w-full" onClick={() => act(m)} aria-haspopup="dialog" aria-label={`Message at ${fmtTime(m.created_at, timezone)}: options`}>
                        {fmtTime(m.created_at, timezone)}
                      </button>
                    </>
                  ) : (
                    <>
                      {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                      <p className="chat-meta">{fmtTime(m.created_at, timezone)}</p>
                    </>
                  )}
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
          {/* One photo button: without `capture`, the phone itself offers the camera or the library. */}
          <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={(e) => void send(e.target.files?.[0])} />
          <button type="button" className="icon-btn" aria-label="Add a photo" disabled={busy} onClick={() => photoRef.current?.click()}>
            <Icon name="camera" size={22} />
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
            placeholder="Message"
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

      {acting && (
        <Sheet title="Message" onClose={closeSheet}>
          {acting.body ? <p className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap break-words">{acting.body}</p> : <p className="muted">A photo, {fmtTime(acting.created_at, timezone)}</p>}
          {sheetMsg && (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {sheetMsg}
            </p>
          )}
          <button type="button" className="btn w-full" onClick={closeSheet}>
            Cancel
          </button>
          {/* Never the first button (DESIGN.md rule 8), and it asks twice. */}
          <button type="button" className="btn btn-danger w-full" disabled={removing} onClick={() => void remove(acting.id)}>
            {armed ? "Tap again to delete" : "Delete message"}
          </button>
        </Sheet>
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
