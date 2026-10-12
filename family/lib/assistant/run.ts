import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssistantReply, AssistantTurn, AssistantUsage, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { buildTools, loadContext, type AssistantTool, type ToolContext } from "./tools";
import { systemBlocks } from "./prompt";
import { anthropicApiKey } from "@/lib/server/anthropic";

export const MODEL = process.env.ASSISTANT_MODEL ?? "claude-opus-5-5";
const EFFORT = (process.env.ASSISTANT_EFFORT ?? "medium") as "low" | "medium" | "high";
const MAX_ROUNDS = 8;
const MAX_TURNS = 12;

export function assistantConfigured(): boolean {
  return !!anthropicApiKey();
}

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: anthropicApiKey(), timeout: 90_000, maxRetries: 2 });
  return _client;
}

export interface RunInput {
  supabase: SupabaseClient;
  me: Me;
  turns: AssistantTurn[];
  question: string;
}

/** Sum of usage over the tool-use loop; what the audit row records. */
function emptyUsage(): AssistantUsage {
  return { model: MODEL, input_tokens: 0, output_tokens: 0, cache_read: 0, cache_write: 0, ms: 0, tool_calls: 0 };
}

function addUsage(u: AssistantUsage, m: Anthropic.Beta.BetaMessage) {
  u.input_tokens += m.usage.input_tokens;
  u.output_tokens += m.usage.output_tokens;
  u.cache_read += m.usage.cache_read_input_tokens ?? 0;
  u.cache_write += m.usage.cache_creation_input_tokens ?? 0;
}

async function audit(supabase: SupabaseClient, kind: string, args: Record<string, unknown>) {
  try {
    await supabase.rpc("assistant_audit", { p_kind: kind, ...args });
  } catch {
    /* the audit row is best effort from the app side; the RPCs the tools called have logged themselves */
  }
}

/**
 * One question → one answer, with as many tool rounds as needed (bounded).
 * Every call is audited (question, tools, answer, proposals, tokens).
 */
export async function askAssistant({ supabase, me, turns, question }: RunInput): Promise<AssistantReply | RpcError> {
  const t0 = Date.now();
  if (!can(me, "assistant", "view")) {
    await audit(supabase, "ask", { p_question: question, p_allowed: false });
    return { ok: false, error: "not_allowed", message: "The assistant is not switched on for your role. Ask Mido or Dana." };
  }
  if (!assistantConfigured()) {
    return { ok: false, error: "not_configured", message: "The assistant is not set up yet (no ANTHROPIC_API_SECRET_KEY on the server)." };
  }

  const ctx = await loadContext(supabase, me);
  const tools = buildTools(ctx);
  const byName = new Map(tools.map((t) => [t.def.name, t]));
  const usage = emptyUsage();
  const toolLog: { name: string; input: unknown; ok: boolean }[] = [];

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...turns.slice(-MAX_TURNS).map((t): Anthropic.Beta.BetaMessageParam => ({ role: t.role, content: t.text })),
    { role: "user", content: question },
  ];

  let answer = "";
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await client().beta.messages.create({
      model: MODEL,
      max_tokens: 2048,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: EFFORT },
      system: systemBlocks(ctx),
      tools: tools.map((t) => t.def),
      messages,
    });
    addUsage(usage, res);

    if (res.stop_reason === "refusal") {
      answer = "I can't help with that one. Try asking it another way, or ask Mido or Dana.";
      break;
    }
    const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
    const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");

    if (res.stop_reason !== "tool_use" || calls.length === 0) {
      answer = text || (res.stop_reason === "max_tokens" ? "That answer got too long. Ask a smaller question." : "I don't know.");
      break;
    }

    // Run every tool call of this turn and return all results in one user message.
    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      const tool = byName.get(call.name);
      const out = await runTool(tool, call, ctx);
      usage.tool_calls += 1;
      toolLog.push({ name: call.name, input: call.input, ok: !out.is_error });
      results.push(out);
    }
    messages.push({ role: "user", content: results });
    if (round === MAX_ROUNDS - 1) answer = text || "I looked but could not finish. Ask a smaller question.";
  }

  usage.ms = Date.now() - t0;
  await audit(supabase, "ask", {
    p_question: question,
    p_answer: answer,
    p_tools: toolLog,
    p_proposals: ctx.proposals.map((p) => ({ id: p.id, kind: p.kind, summary: p.summary })),
    p_usage: usage,
  });
  return { ok: true, answer, proposals: ctx.proposals, refs: ctx.refs, usage };
}

async function runTool(tool: AssistantTool | undefined, call: Anthropic.Beta.BetaToolUseBlock, ctx: ToolContext): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  if (!tool) return { type: "tool_result", tool_use_id: call.id, is_error: true, content: `Unknown tool ${call.name}` };
  try {
    const input = (call.input && typeof call.input === "object" ? call.input : {}) as Record<string, unknown>;
    const out = await tool.run(input, ctx);
    const isErr = !!(out && typeof out === "object" && ("error" in (out as object) || (out as { ok?: boolean }).ok === false));
    return { type: "tool_result", tool_use_id: call.id, is_error: isErr, content: JSON.stringify(out ?? null) };
  } catch (e) {
    return { type: "tool_result", tool_use_id: call.id, is_error: true, content: e instanceof Error ? e.message : "tool failed" };
  }
}

/** A single, tool-free call: used for the briefs. */
export async function compose(system: Anthropic.Beta.BetaTextBlockParam[], user: string, maxTokens = 1200): Promise<{ text: string; usage: AssistantUsage; refusal: boolean }> {
  const t0 = Date.now();
  const usage = emptyUsage();
  const res = await client().beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: EFFORT },
    system,
    messages: [{ role: "user", content: user }],
  });
  addUsage(usage, res);
  usage.ms = Date.now() - t0;
  const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
  return { text, usage, refusal: res.stop_reason === "refusal" };
}
