"use client";
import Link from "next/link";
import type { AssistantRef } from "@/lib/types";

/**
 * Renders assistant text. Citations like [entry:ID], [event:ID], [ticket:ID],
 * [item:ID] become links to the thing the answer came from. Lines starting with
 * "- " or "• " become a list; "**bold**" is honoured; nothing else is parsed.
 */
const CITE = /\[(entry|event|ticket|item):([\w-]{1,40})[^\]]*\]/g;

function hrefFor(kind: string, id: string, refs: Record<string, AssistantRef>): { href: string; label: string } {
  const r = refs[id];
  if (r) return r;
  if (kind === "entry") return { href: `/entry/${id}`, label: "open" };
  if (kind === "event") return { href: "/calendar", label: "calendar" };
  if (kind === "ticket") return { href: `/house/tickets/${id}`, label: "ticket" };
  return { href: `/shopping/${id}`, label: "item" };
}

function inline(text: string, refs: Record<string, AssistantRef>, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(CITE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(...bold(text.slice(last, start), `${keyBase}-t${n}`));
    const { href, label } = hrefFor(m[1], m[2], refs);
    out.push(
      <Link key={`${keyBase}-c${n}`} href={href} className="cite">
        {label}
      </Link>,
    );
    last = start + m[0].length;
    n += 1;
  }
  if (last < text.length) out.push(...bold(text.slice(last), `${keyBase}-t${n}`));
  return out;
}

function bold(text: string, keyBase: string): React.ReactNode[] {
  const parts = text.split(/\*\*([^*]+)\*\*/g);
  return parts.map((p, i) => (i % 2 === 1 ? <b key={`${keyBase}-b${i}`}>{p}</b> : <span key={`${keyBase}-s${i}`}>{p}</span>));
}

export function Cited({ text, refs = {} }: { text: string; refs?: Record<string, AssistantRef> }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={`ul${blocks.length}`} className="ml-5 list-disc">
          {list.map((l, i) => (
            <li key={i}>{inline(l, refs, `l${blocks.length}-${i}`)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  lines.forEach((raw, i) => {
    const line = raw.trim();
    const m = line.match(/^(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (m) {
      list.push(m[1]);
      return;
    }
    flush();
    if (!line) return;
    const h = line.match(/^#{1,3}\s+(.*)$/);
    blocks.push(
      h ? (
        <p key={`p${i}`} className="font-semibold">
          {inline(h[1], refs, `h${i}`)}
        </p>
      ) : (
        <p key={`p${i}`}>{inline(line, refs, `p${i}`)}</p>
      ),
    );
  });
  flush();
  return <div className="flex flex-col gap-2">{blocks}</div>;
}
