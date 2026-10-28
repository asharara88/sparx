"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { dismissFailed, flushQueue, onQueueChange, readFailed, readQueue } from "@/lib/offline";

/**
 * Sends queued entries when the phone is back online, shows how many are waiting,
 * and shows the ones the server refused (they are never dropped quietly).
 */
export function OfflineFlusher() {
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const [online, setOnline] = useState(true);
  // The signed-in user; undefined until the session is read (then every owner's rows show).
  const [owner, setOwner] = useState<string | null | undefined>(undefined);
  const router = useRouter();

  useEffect(() => {
    const supabase = supabaseBrowser();
    let owner: string | null | undefined;
    const refresh = () => {
      setPending(readQueue(owner).length);
      setFailed(readFailed(owner).map((f) => f.message));
    };
    const flush = async () => {
      setOnline(navigator.onLine);
      if (!navigator.onLine) return;
      if (readQueue(owner).length === 0) return;
      const { sent } = await flushQueue(supabase);
      refresh();
      if (sent > 0) router.refresh();
    };
    void supabase.auth.getSession().then(({ data }: { data: { session: { user: { id: string } } | null } }) => {
      owner = data.session?.user.id ?? null;
      setOwner(owner);
      refresh();
      void flush();
    });
    refresh();
    const unsubscribe = onQueueChange(refresh);
    window.addEventListener("online", flush);
    const offline = () => setOnline(false);
    window.addEventListener("offline", offline);
    const t = setInterval(flush, 30_000);
    return () => {
      window.removeEventListener("online", flush);
      window.removeEventListener("offline", offline);
      unsubscribe();
      clearInterval(t);
    };
  }, [router]);

  if (online && pending === 0 && failed.length === 0) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-[env(safe-area-inset-top)] z-30 mx-auto max-w-2xl bg-[var(--warn-soft)] p-2 text-center text-[var(--warn)] text-sm font-semibold text-amber-900"
    >
      {!online ? "No internet. " : ""}
      {pending > 0 ? `${pending} ${pending === 1 ? "entry" : "entries"} saved on this phone, waiting to send.` : online ? "" : "Back online."}
      {failed.length > 0 && (
        <span className="block">
          {failed.length === 1 ? "One entry could not be sent" : `${failed.length} entries could not be sent`}: {Array.from(new Set(failed)).join("; ")}{" "}
          <button type="button" className="underline" onClick={() => dismissFailed(owner)}>
            Dismiss
          </button>
        </span>
      )}
    </div>
  );
}
