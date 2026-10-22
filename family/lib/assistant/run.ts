import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssistantEvent, AssistantReply, AssistantTurn, AssistantUsage, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { buildTools, loadContext, type AssistantTool, type ToolContext } from "./tools";
import { systemBlocks } from "./prompt";
import { loadSituation } from "./situation";
import { anthropicOptions, modelConfigured } from "@/lib/server/anthropic";
import { isAbort, withTimeout } from "./wait";

/**
 * The agent loop. One question in, one answer out, with as many tool rounds
 * as it needs, bounded. What makes it the family's helper rather than a chat:
 *  - the skills the router picked and the situation snapshot are in the prompt
 *    before the first token (see prompt.ts), so most answers need no tool;
 *  - every tool runs as the member, through the same RPCs the screens use;
 *  - tools of one round run in parallel with a timeout and a size cap;
 *  - the last round is forced to answer in words, so it never ends with
 *    "could not finish";
 *  - text streams to the phone as it is written; a round that turns out to be
 *    a tool round is reset on the client so what is shown is what is saved;
 *  - every call is audited: question, skills, tools, answer, proposals, tokens;
 *  - when the member ends the conversation the request's signal aborts, and
 *    that stops the model stream, the wait on any tool, and the next round.
 */

export const MODEL = process.env.ASSISTANT_MODEL ?? "claude-opus-5-5";
const EFFORT = (process.env.ASSISTANT_EFFORT ?? "medium") as "low" | "medium" | "high";
const MAX_ROUNDS = 6;
const MAX_TURNS = 14;
const MAX_TOKENS = 2048;
const TOOL_TIMEOUT_MS = 20_000;
const TOOL_RESULT_MAX_CHARS = 14_000;

export function assistantConfigured(): boolean {
  return modelConfigured();
}

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic(anthropicOptions({ timeout: 90_000 }));
  return _client;
}

export interface RunInput {
  supabase: SupabaseClient;
  me: Me;
  turns: AssistantTurn[];
  question: string;
  /** Which screen the member came from (home, lana, milk, plan…). */
  screen?: string | null;
  /** Called as the answer is written and as tools run; the route streams these. */
  onEvent?: (e: AssistantEvent) => void;
  /** Aborts when the member ends the conversation or the connection drops: no more model calls or tool rounds. */
  signal?: AbortSignal;
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

/** What the phone shows while a tool runs. Plain words, not tool names. */
const STATUS: Record<string, string> = {
  care_now: "Checking the log",
  care_entries: "Reading the log",
  care_stats: "Adding up the week",
  sleep_rhythm: "Looking at the sleep rhythm",
  age_outlook: "Checking the age",
  day_schedule: "Working out the day",
  red_flag_check: "Checking for warning signs",
  coach_plan: "Reading the plan",
  plan_history: "Looking at earlier plans",
  recent_chats: "Looking at earlier chats",
  load_skill: "Reading up",
  who_is_home: "Checking who is home",
  calendar: "Reading the calendar",
  due_soon: "Checking what is due",
};

function statusFor(calls: Anthropic.Beta.BetaToolUseBlock[]): string {
  const names = [...new Set(calls.map((c) => c.name))];
  if (names.every((n) => n.startsWith("propose_"))) return "Preparing it for you to confirm";
  const first = names.find((n) => !n.startsWith("propose_")) ?? names[0];
  return `${STATUS[first] ?? "Looking"}…`;
}

export async function askAssistant({ supabase, me, turns, question, screen = null, onEvent, signal }: RunInput): Promise<AssistantReply | RpcError> {
  const t0 = Date.now();
  const emit = (e: AssistantEvent) => {
    try {
      onEvent?.(e);
    } catch {
      /* a closed stream must not stop the answer */
    }
  };
  if (!can(me, "assistant", "view")) {
    await audit(supabase, "ask", { p_question: question, p_allowed: false });
    return { ok: false, error: "not_allowed", message: "The assistant is not switched on for your role. Ask an admin." };
  }
  if (!assistantConfigured()) {
    return { ok: false, error: "not_configured", message: "The assistant is not set up yet (no ANTHROPIC_API_SECRET_KEY on the server)." };
  }

  const usage = emptyUsage();
  const toolLog: { name: string; input: unknown; ok: boolean }[] = [];
  // The member ended it (or the connection dropped): stop here, record what was spent, say so.
  const stopped = async (): Promise<RpcError> => {
    usage.ms = Date.now() - t0;
    await audit(supabase, "ask", { p_question: question, p_answer: "(stopped by the member)", p_tools: toolLog, p_proposals: [], p_usage: usage });
    return { ok: false, error: "cancelled", message: "Stopped." };
  };

  const history = turns.filter((t) => t.role === "user").map((t) => t.text);
  if (signal?.aborted) return stopped();
  const ctx = await loadContext(supabase, me, new Date(), { question, history, screen });
  ctx.signal = signal;
  // A conversation ended during the context reads goes no further: no situation snapshot, no model.
  if (signal?.aborted) return stopped();
  ctx.situation = await loadSituation(ctx).catch(() => "");
  if (signal?.aborted) return stopped();
  const tools = buildTools(ctx);
  const byName = new Map(tools.map((t) => [t.def.name, t]));
  const system = systemBlocks(ctx);
  const defs = tools.map((t) => t.def);

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...turns.slice(-MAX_TURNS).map((t): Anthropic.Beta.BetaMessageParam => ({ role: t.role, content: t.text })),
    { role: "user", content: question },
  ];

  let answer = "";
  let refused = false;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (signal?.aborted) return stopped();
    const last = round === MAX_ROUNDS - 1;
    const stream = client().beta.messages.stream(
      {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: EFFORT },
      system,
      tools: defs,
        // The last round must answer in words: no more tools.
        ...(last ? { tool_choice: { type: "none" as const } } : {}),
        messages,
      },
      // The same signal the route got from the connection: an End tap aborts the stream itself.
      signal ? { signal } : undefined,
    );
    stream.on("text", (delta) => emit({ type: "delta", text: delta }));
    // What this round has cost so far, in case it is stopped before its final message:
    // the input is counted at message_start, the output grows with each message_delta.
    const partial = { input_tokens: 0, output_tokens: 0, cache_read: 0, cache_write: 0 };
    stream.on("streamEvent", (ev) => {
      if (ev.type === "message_start") {
        partial.input_tokens = ev.message.usage.input_tokens;
        partial.cache_read = ev.message.usage.cache_read_input_tokens ?? 0;
        partial.cache_write = ev.message.usage.cache_creation_input_tokens ?? 0;
      } else if (ev.type === "message_delta") partial.output_tokens = ev.usage.output_tokens;
    });
    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await stream.finalMessage();
    } catch (e) {
      if (isAbort(e, signal)) {
        usage.input_tokens += partial.input_tokens;
        usage.output_tokens += partial.output_tokens;
        usage.cache_read += partial.cache_read;
        usage.cache_write += partial.cache_write;
        return stopped();
      }
      throw e;
    }
    addUsage(usage, res);

    if (res.stop_reason === "refusal") {
      refused = true;
      emit({ type: "reset" });
      answer = "I can't help with that one. Try asking it another way, or ask an admin.";
      break;
    }
    const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
    const calls = res.stop_reason === "tool_use" ? res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use") : [];

    if (calls.length === 0) {
      answer = text || (res.stop_reason === "max_tokens" ? "That answer got too long. Ask a smaller question." : "I don't know.");
      break;
    }

    // A tool round: whatever text it streamed is thinking-aloud, not the answer.
    emit({ type: "reset" });
    emit({ type: "status", text: statusFor(calls) });
    messages.push({ role: "assistant", content: res.content });
    const results = await Promise.all(calls.map((call) => runTool(byName.get(call.name), call, ctx, signal)));
    if (signal?.aborted) return stopped();
    for (let i = 0; i < calls.length; i++) {
      usage.tool_calls += 1;
      toolLog.push({ name: calls[i].name, input: calls[i].input, ok: !results[i].is_error });
    }
    messages.push({ role: "user", content: results });
  }
  if (!answer) answer = "I looked but could not put an answer together. Ask it a smaller way.";

  usage.ms = Date.now() - t0;
  const skills = [...ctx.selection.routed, ...ctx.loaded.filter((l) => !ctx.selection.routed.some((r) => r.id === l.id))].map((s) => ({ id: s.id, title: s.title }));
  await audit(supabase, "ask", {
    p_question: question,
    p_answer: answer,
    p_tools: [{ name: "skills", input: { routed: ctx.selection.routed.map((s) => s.id), loaded: ctx.loaded.map((s) => s.id), screen }, ok: !refused }, ...toolLog],
    p_proposals: ctx.proposals.map((p) => ({ id: p.id, kind: p.kind, summary: p.summary })),
    p_usage: usage,
  });
  const reply: AssistantReply = { ok: true, answer, proposals: ctx.proposals, refs: ctx.refs, usage, skills, tools: toolLog.map((t) => t.name) };
  emit({ type: "done", reply });
  return reply;
}

/** A tool result the model can read: an object, capped in size; errors flagged so it can say so. */
async function runTool(tool: AssistantTool | undefined, call: Anthropic.Beta.BetaToolUseBlock, ctx: ToolContext, signal?: AbortSignal): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  if (!tool) return { type: "tool_result", tool_use_id: call.id, is_error: true, content: `Unknown tool ${call.name}` };
  if (signal?.aborted) return { type: "tool_result", tool_use_id: call.id, is_error: true, content: "stopped" };
  try {
    const input = (call.input && typeof call.input === "object" ? call.input : {}) as Record<string, unknown>;
    const out = await withTimeout(tool.run(input, ctx), TOOL_TIMEOUT_MS, call.name, signal);
    const isErr = !!(out && typeof out === "object" && ("error" in (out as object) || (out as { ok?: boolean }).ok === false));
    let content = JSON.stringify(out ?? null);
    if (content.length > TOOL_RESULT_MAX_CHARS) content = `${content.slice(0, TOOL_RESULT_MAX_CHARS)}… [cut: too much data; ask for a shorter range or a smaller question]`;
    return { type: "tool_result", tool_use_id: call.id, is_error: isErr, content };
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
