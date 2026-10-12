"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CartReport, CartReportItem, CartResult, CartRun, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { handoffText } from "@/lib/shopping/handoff";
import { Icon } from "@/components/Icon";

const RESULTS: { id: CartResult; label: string }[] = [
  { id: "found", label: "Found" },
  { id: "substituted", label: "Substituted" },
  { id: "missing", label: "Missing" },
];

/** One prepared cart: the handoff text, then the agent's report, then "I paid". */
export function CartRunView({ run }: { run: CartRun }) {
  const me = useMe();
  const router = useRouter();
  const text = handoffText(run.manifest, run.id.slice(0, 8));
  const [copied, setCopied] = useState(false);
  const [pasted, setPasted] = useState("");
  const [report, setReport] = useState<CartReport>(
    run.report ?? { summary: null, items: run.manifest.items.map((i) => ({ item_id: i.item_id, result: "missing" as const, product: null, price: null, note: null })) },
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const closed = run.status === "done" || run.status === "cancelled";
  const canClose = can(me, "shopping", "edit");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMsg("Could not copy. Select the text and copy it by hand.");
    }
  }
  async function parse() {
    if (!pasted.trim()) return;
    setBusy("parse");
    setMsg(null);
    const r = await fetch("/api/cart/parse", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: run.id, text: pasted }) });
    const out = (await r.json()) as { ok: true; report: CartReport } | RpcError;
    setBusy(null);
    if (!out.ok) return setMsg(out.message ?? "Could not read the report.");
    setReport(out.report);
  }
  function setItem(id: string, patch: Partial<CartReportItem>) {
    setReport((rep) => ({ ...rep, items: rep.items.map((i) => (i.item_id === id ? { ...i, ...patch } : i)) }));
  }
  async function save() {
    setBusy("save");
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("cart_run_report", { p_id: run.id, p_report: report });
    setBusy(null);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    setMsg("Report saved.");
    router.refresh();
  }
  async function close(paid: boolean) {
    if (!confirm(paid ? "Mark the found and substituted items as bought today?" : "Cancel this cart?")) return;
    setBusy("close");
    const { data, error } = await supabaseBrowser().rpc("cart_run_close", { p_id: run.id, p_paid: paid });
    setBusy(null);
    const res = data as { ok: boolean; bought?: number; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not close.");
    setMsg(paid ? `${res.bought} ${res.bought === 1 ? "item" : "items"} marked as bought.` : "Cancelled.");
    router.refresh();
  }

  const counts = RESULTS.map((r) => ({ ...r, n: report.items.filter((i) => i.result === r.id).length }));

  return (
    <div className="flex flex-col gap-4">
      <header className="page-header flex items-center gap-2">
        <Link href="/shopping/cart" className="icon-btn" aria-label="Back">
          <Icon name="back" size={24} />
        </Link>
        <div>
          <h1 className="page-title">{run.store_label} cart</h1>
          <p className="muted text-sm">
            {run.manifest.items.length} items · {run.status}
            {run.created_by_name ? ` · ${run.created_by_name}` : ""}
          </p>
        </div>
      </header>

      <section className="card flex flex-col gap-2">
        <h2 className="text-lg font-bold">1. Hand it to the cart agent</h2>
        <p className="muted text-sm">Copy this, open the shop, and paste it to Claude in Chrome (or whoever drives the browser). It stops at checkout and never pays.</p>
        <textarea className="input font-mono text-xs" rows={8} readOnly value={text} aria-label="Instructions for the cart agent" />
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-primary" onClick={copy}>
            {copied ? "Copied" : "Copy the instructions"}
          </button>
          {run.store_url && (
            <a className="btn" href={run.store_url} target="_blank" rel="noreferrer">
              Open {run.store_label} ↗
            </a>
          )}
        </div>
      </section>

      <section className="card flex flex-col gap-2">
        <h2 className="text-lg font-bold">2. What did it find?</h2>
        {!closed && (
          <>
            <textarea className="input" rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste the agent's report here…" aria-label="The agent's report" />
            <button type="button" className="btn" onClick={parse} disabled={busy !== null || !pasted.trim()}>
              {busy === "parse" ? "Reading…" : "Read the report"}
            </button>
          </>
        )}
        <p className="text-sm">{counts.map((c) => `${c.n} ${c.label.toLowerCase()}`).join(" · ")}</p>
        <ul className="flex flex-col gap-3">
          {run.manifest.items.map((m) => {
            const it = report.items.find((i) => i.item_id === m.item_id) ?? { item_id: m.item_id, result: "missing" as const };
            return (
              <li key={m.item_id} className="border-b border-[var(--line)] pb-2 last:border-0">
                <p className="font-semibold">{m.name}</p>
                {it.product && it.result === "substituted" && <p className="muted text-sm">→ {it.product}</p>}
                {it.note && <p className="muted text-sm">{it.note}</p>}
                {!closed ? (
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {RESULTS.map((r) => (
                      <button key={r.id} type="button" className="chip text-sm" style={{ padding: "6px 12px", minHeight: 40 }} aria-pressed={it.result === r.id} onClick={() => setItem(m.item_id, { result: r.id })}>
                        {r.label}
                      </button>
                    ))}
                    <input className="input w-28" style={{ minHeight: 40, padding: "6px 10px" }} type="number" inputMode="decimal" step="0.01" placeholder="price" aria-label={`Price of ${m.name}`} value={it.price ?? ""} onChange={(e) => setItem(m.item_id, { price: e.target.value ? Number(e.target.value) : null })} />
                  </div>
                ) : (
                  <p className="text-sm">
                    {RESULTS.find((r) => r.id === it.result)?.label}
                    {it.price != null ? ` · ${it.price} ${run.manifest.currency}` : ""}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        {report.summary && <p className="muted text-sm">{report.summary}</p>}
        {!closed && (
          <button type="button" className="btn" onClick={save} disabled={busy !== null}>
            {busy === "save" ? "Saving…" : "Save the report"}
          </button>
        )}
      </section>

      {msg && (
        <p role="status" className={`notice ${/saved|marked|Cancelled/.test(msg) ? "notice-ok" : "notice-danger"}`}>
          {msg}
        </p>
      )}

      {!closed && (
        <section className="card flex flex-col gap-2">
          <h2 className="text-lg font-bold">3. You check out and pay</h2>
          <p className="muted text-sm">The app never pays. When you have, tap below: found and substituted items are marked bought today at the reported price, and the reorder interval learns from it.</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn" onClick={() => close(false)} disabled={busy !== null || !canClose}>
              Cancel this cart
            </button>
            <button type="button" className="btn btn-primary min-h-[64px]" onClick={() => close(true)} disabled={busy !== null || !canClose || run.status === "prepared"} title={run.status === "prepared" ? "Save the report first" : ""}>
              I paid
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
