import type { SupabaseClient } from "@supabase/supabase-js";
import type { Me } from "@/lib/types";
import type { MemoryFact } from "./memory";
import { client } from "./run";
import { checkAllowance } from "./allowance";
import { anthropicApiKey, federationConfigured } from "@/lib/server/anthropic";
import { newCandidates, parseCandidates, rememberPrompt, shouldMine, type MemoryCandidate } from "./remember";

/**
 * Reads one of the member's saved chats and stores what the helper noticed as
 * suggestions (memory_suggest), for the family to keep or drop on the memory
 * screen. One small model call per chat read; on by default where the model
 * is configured, off with ASSISTANT_REMEMBER=0 on the server. Never writes a
 * kept memory.
 */

export const REMEMBER_MODEL = process.env.ASSISTANT_REMEMBER_MODEL ?? "claude-haiku-5-5";

export function rememberEnabled(): boolean {
  const v = (process.env.ASSISTANT_REMEMBER ?? "").trim().toLowerCase();
  const off = v === "0" || v === "false" || v === "off";
  return !off && !!(anthropicApiKey() || federationConfigured());
}

type Msg = { role?: string; text?: string };

/** The chat as the reader sees it: the member's and the helper's words, cards summarised, capped. */
export function transcriptOf(messages: unknown[], maxChars = 12_000): { text: string; userTurns: number } {
  const ms = (Array.isArray(messages) ? messages : []).filter((m): m is Msg => !!m && typeof m === "object" && typeof (m as Msg).text === "string");
  const lines = ms.filter((m) => m.role === "user" || m.role === "assistant").map((m) => `${m.role === "user" ? "MEMBER" : "HELPER"}: ${(m.text ?? "").replace(/\s*\[[a-z]+:[^\]]+\]/g, "").replace(/\s+/g, " ").trim().slice(0, 1500)}`);
  const text = lines.join("\n");
  return { text: text.length > maxChars ? text.slice(-maxChars) : text, userTurns: ms.filter((m) => m.role === "user").length };
}

export interface RememberResult {
  ok: true;
  read: boolean;
  added: number;
  candidates: number;
}

export async function rememberFromChat(supabase: SupabaseClient, me: Me, chatId: string): Promise<RememberResult | { ok: false; error: string; message?: string }> {
  const { data: chat } = await supabase.from("ask_chats").select("id, messages, mined_turns").eq("id", chatId).maybeSingle();
  const row = chat as { id: string; messages: unknown[]; mined_turns: number } | null;
  if (!row) return { ok: false, error: "not_found" };
  const { text, userTurns } = transcriptOf(row.messages);
  if (!shouldMine(userTurns, row.mined_turns ?? 0)) return { ok: true, read: false, added: 0, candidates: 0 };
  // Past today's allowance the chat is simply not read; nobody is waiting on it.
  const allowed = await checkAllowance(supabase, me);
  if (!allowed.ok) return { ok: true, read: false, added: 0, candidates: 0 };

  const [{ data: memData }, { data: members }, { data: subjects }] = await Promise.all([
    supabase.rpc("memory_list"),
    supabase.from("members").select("id, display_name").eq("is_active", true),
    supabase.from("care_subjects").select("id, name").eq("is_active", true),
  ]);
  const mem = memData as { ok?: boolean; items?: MemoryFact[]; dropped?: string[] } | null;
  // What it knows, and what the family already dropped: neither is offered again.
  const existing = [...((mem?.items ?? []) as MemoryFact[]).map((m) => m.body), ...((mem?.dropped ?? []) as string[])];
  const people = ((members as { id: string; display_name: string }[] | null) ?? []).map((m) => ({ id: m.id, name: m.display_name }));
  const kids = ((subjects as { id: string; name: string }[] | null) ?? []).map((s) => ({ id: s.id, name: s.name }));

  const res = await client().beta.messages.create({
    model: REMEMBER_MODEL,
    max_tokens: 600,
    system: rememberPrompt({ people: people.map((p) => p.name), children: kids.map((k) => k.name), existing }),
    messages: [{ role: "user", content: `The member is ${me.member.display_name}. The chat:\n\n${text}\n\nReturn the JSON array now.` }],
  });
  const out = res.content.filter((b): b is Extract<(typeof res.content)[number], { type: "text" }> => b.type === "text").map((b) => b.text).join("\n");
  const cands = newCandidates(parseCandidates(out), existing);
  const byName = (list: { id: string; name: string }[], name: string | null | undefined) => list.find((x) => x.name.toLowerCase() === (name ?? "").trim().toLowerCase())?.id ?? null;
  const items = cands.map((c: MemoryCandidate) => {
    const about = c.kind === "person" ? byName(people, c.about) : null;
    const subject = c.kind === "child" ? byName(kids, c.about) : null;
    // A link the model got wrong is not a reason to lose the sentence: it becomes a home fact.
    const kind = (c.kind === "person" && !about) || (c.kind === "child" && !subject) ? "home" : c.kind;
    return { body: c.body, kind, about_member_id: kind === "person" ? about : null, subject_id: kind === "child" ? subject : null };
  });
  const { data: saved } = await supabase.rpc("memory_suggest", { p_chat_id: chatId, p_turns: userTurns, p_items: items });
  const s = saved as { ok?: boolean; added?: number; error?: string } | null;
  try {
    await supabase.rpc("assistant_audit", {
      p_kind: "remember",
      p_question: `read chat ${chatId}`,
      p_answer: items.map((i) => i.body).join(" | ") || "(nothing new)",
      p_usage: { model: REMEMBER_MODEL, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens, cache_read: 0, cache_write: 0, ms: 0, tool_calls: 0 },
    });
  } catch {
    /* best effort */
  }
  if (!s?.ok) return { ok: false, error: s?.error ?? "failed" };
  return { ok: true, read: true, added: s.added ?? 0, candidates: items.length };
}
