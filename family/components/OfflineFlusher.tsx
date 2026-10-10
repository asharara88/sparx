"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { flushQueue, readQueue } from "@/lib/offline";

/** Sends queued entries when the phone is back online and shows how many are waiting. */
export function OfflineFlusher() {
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const supabase = supabaseBrowser();
    const refresh = () => setPending(readQueue().length);
    const flush = async () => {
      setOnline(navigator.onLine);
      if (!navigator.onLine) return;
      if (readQueue().length === 0) return;
      const sent = await flushQueue(supabase);
      refresh();
      if (sent > 0) router.refresh();
    };
    refresh();
    flush();
    window.addEventListener("online", flush);
    window.addEventListener("offline", () => setOnline(false));
    window.addEventListener("storage", refresh);
    const t = setInterval(flush, 30_000);
    return () => {
      window.removeEventListener("online", flush);
      window.removeEventListener("storage", refresh);
      clearInterval(t);
    };
  }, [router]);

  if (online && pending === 0) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 mx-auto max-w-2xl border-b-2 border-amber-700 bg-amber-50 p-2 text-center text-sm font-semibold text-amber-900"
    >
      {!online ? "No internet. " : ""}
      {pending > 0 ? `${pending} ${pending === 1 ? "entry" : "entries"} saved on this phone, waiting to send.` : "Back online."}
    </div>
  );
}
