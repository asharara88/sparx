"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BackupRow } from "@/lib/types";
import { fmtDateTime } from "@/lib/time";
import { Icon } from "@/components/Icon";
import { apiFetch } from "@/lib/supabase/client";

const mb = (b: number) => (b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** The nightly backups: when, how many rows, and a download of each table. */
export function BackupsCard({ rows }: { rows: BackupRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  async function runNow() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiFetch("/api/backups", { method: "POST" });
      const data = (await res.json()) as { ok: boolean; message?: string; rows?: number };
      setMsg(data.ok ? `Done: ${data.rows} rows saved.` : (data.message ?? "Backup failed."));
      router.refresh();
    } catch {
      setMsg("Backup failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card flex flex-col gap-2" aria-labelledby="bk-h">
      <div className="flex items-center justify-between gap-2">
        <h2 id="bk-h" className="text-lg font-semibold">
          Backups
        </h2>
        <button type="button" className="btn" style={{ minHeight: 40 }} disabled={busy} onClick={() => void runNow()}>
          {busy ? "Saving…" : "Back up now"}
        </button>
      </div>
      <p className="muted text-sm">Every night at 03:00 your home&apos;s data is saved as compressed JSON, one file per table, with a list of the photos. The newest 8 are kept.</p>
      {rows.length === 0 ? (
        <p className="muted text-sm">No backup yet. The first one runs tonight, or tap “Back up now”.</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((r) => (
            <li key={r.id} className="row flex-col items-stretch">
              <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                <Icon name="clipboard" size={18} className="muted" />
                <span className="grow">
                  <span className="block font-semibold">{fmtDateTime(r.created_at, Intl.DateTimeFormat().resolvedOptions().timeZone)}</span>
                  <span className="muted block text-sm">
                    {r.rows} rows · {Object.keys(r.tables).length} tables · {r.photos} photos · {mb(r.size_bytes)}
                  </span>
                </span>
                <Icon name="forward" size={16} className={`muted transition-transform ${open === r.id ? "rotate-90" : ""}`} />
              </button>
              {open === r.id && (
                <ul className="mt-2 flex flex-wrap gap-1">
                  <li>
                    <a className="chip" href={`/api/backups?path=${encodeURIComponent(`${r.path}/manifest.json`)}`}>
                      manifest
                    </a>
                  </li>
                  {Object.entries(r.tables).map(([t, n]) => (
                    <li key={t}>
                      <a className="chip" href={`/api/backups?path=${encodeURIComponent(`${r.path}/${t}.json.gz`)}`}>
                        {t} <span className="muted">· {n}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="text-sm">{msg}</p>}
    </section>
  );
}
