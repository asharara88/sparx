import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CartManifest, CartReport, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { assistantConfigured, MODEL } from "@/lib/assistant/run";
import { anthropicApiKey } from "@/lib/server/anthropic";

/** Turn the cart agent's pasted summary into a per-item report. Nothing is saved here. */
const ReportSchema = z.object({
  summary: z.string().nullable().describe("One line: cart total and anything odd"),
  items: z.array(
    z.object({
      item_id: z.string().describe("The item_id from the manifest"),
      result: z.enum(["found", "substituted", "missing"]),
      product: z.string().nullable().describe("What was put in the cart, if named"),
      price: z.number().nullable().describe("Price of that cart line, if given"),
      note: z.string().nullable(),
    }),
  ),
});

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: anthropicApiKey(), timeout: 60_000, maxRetries: 2 });
  return _client;
}

export async function parseCartReport(supabase: SupabaseClient, me: Me, runId: string, text: string): Promise<{ ok: true; report: CartReport } | RpcError> {
  if (!can(me, "shopping", "add")) return { ok: false, error: "not_allowed", message: "You are not allowed to do this." };
  if (!assistantConfigured()) return { ok: false, error: "not_configured", message: "Not set up yet (no ANTHROPIC_API_SECRET_KEY on the server)." };
  const { data } = await supabase.rpc("cart_run_get", { p_id: runId });
  const run = (data as { ok: boolean; run?: { manifest: CartManifest } } | null)?.run;
  if (!run) return { ok: false, error: "not_found", message: "Cart not found." };

  const t0 = Date.now();
  const res = await client().beta.messages.parse({
    model: MODEL,
    max_tokens: 2048,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(ReportSchema) },
    system: "You match a shopping agent's report against the list it was given. Every manifest item gets exactly one result. An item the report does not mention is missing. Prices are numbers without currency.",
    messages: [
      {
        role: "user",
        content: `Manifest items (item_id and name):\n${JSON.stringify(run.manifest.items.map((i) => ({ item_id: i.item_id, name: i.name })))}\n\nThe agent's report:\n${text.slice(0, 6000)}`,
      },
    ],
  });
  const parsed = res.parsed_output;
  try {
    await supabase.rpc("assistant_audit", {
      p_kind: "cart_report",
      p_question: `parse cart report ${runId}`,
      p_answer: parsed ? `${parsed.items.length} items` : "unparsed",
      p_usage: { model: MODEL, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens, ms: Date.now() - t0 },
    });
  } catch {
    /* best effort */
  }
  if (!parsed) return { ok: false, error: "unparsed", message: "I could not make sense of that report. Set each item by hand." };
  // Keep only manifest items, in manifest order; anything the model missed is "missing".
  const known = new Map(parsed.items.map((i) => [i.item_id, i]));
  const items = run.manifest.items.map((m) => {
    const k = known.get(m.item_id);
    return k ? { item_id: m.item_id, result: k.result, product: k.product, price: k.price, note: k.note } : { item_id: m.item_id, result: "missing" as const, product: null, price: null, note: "not in the report" };
  });
  return { ok: true, report: { summary: parsed.summary, items } };
}
