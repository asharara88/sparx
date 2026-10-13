import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Me, MilkReading, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { todayYmd } from "@/lib/time";
import { assistantConfigured, MODEL } from "@/lib/assistant/run";
import { anthropicOptions } from "@/lib/server/anthropic";

/**
 * Read a milk photo: a storage bag with a handwritten label (date, morning or
 * night, ml) or a bottle with a printed ml scale. The model reads; the member
 * checks the numbers and taps Add. Nothing is written here.
 */

const Schema = z.object({
  kind: z.enum(["bag", "bottle", "none"]).describe("bag: a storage bag with a label; bottle: a feeding or pump bottle with a ml scale; none: neither, or unreadable"),
  date: z.string().nullable().describe("The date written on the label as YYYY-MM-DD, or null if none"),
  source: z.enum(["morning", "night"]).nullable().describe("Which was marked or written on the label: morning (sun) or night (moon); null if neither"),
  ml: z.number().nullable().describe("The amount in ml: the handwritten number on a bag, or the milk level read off a bottle's scale rounded to the nearest 10"),
  confidence: z.enum(["high", "low"]).describe("low when the writing is unclear or the level is hard to read"),
});

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic(anthropicOptions({ timeout: 60_000 }));
  return _client;
}

export async function readMilkPhoto(supabase: SupabaseClient, me: Me, dataUrl: string): Promise<({ ok: true } & MilkReading) | RpcError> {
  if (!can(me, "lana", "add")) return { ok: false, error: "not_allowed", message: "You are not allowed to add milk." };
  if (!assistantConfigured()) return { ok: false, error: "not_configured", message: "Photo reading is not set up yet (no ANTHROPIC_API_SECRET_KEY on the server)." };
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return { ok: false, error: "bad_request", message: "That is not a photo we can read." };
  if (m[2].length > 6_000_000) return { ok: false, error: "too_big", message: "That photo is too big. Try again." };
  const today = todayYmd(me.household.timezone);
  const t0 = Date.now();
  const res = await client().beta.messages.parse({
    model: MODEL,
    max_tokens: 400,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(Schema) },
    system:
      "You read photos of expressed breast milk for a family. Either a storage bag (Medela, Lansinoh or similar) with a handwritten label, or a baby or pump bottle with a printed ml scale. On a bag, use the handwritten amount, never the printed capacity; the label usually has a sun and a moon and the circled or ticked one (or the written word) says morning or night; if a year is missing or clearly wrong, use the most recent past date that fits. On a bottle, read the milk level against the scale and round to the nearest 10 ml; date and source are null. Never guess an amount you cannot see: return null and low confidence.",
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: m[1] as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: m[2] } },
          { type: "text", text: `Read this milk photo. Today is ${today}.` },
        ],
      },
    ],
  });
  const reading = res.parsed_output;
  try {
    await supabase.rpc("assistant_audit", { p_kind: "milk_scan", p_question: "read milk photo", p_answer: reading ? JSON.stringify(reading) : "could not read", p_usage: { model: MODEL, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens, ms: Date.now() - t0 } });
  } catch {
    /* best effort */
  }
  if (res.stop_reason === "refusal" || !reading) return { ok: false, error: "unreadable", message: "I could not read that photo. Try closer, with the label flat and in good light." };
  if (reading.kind === "none") return { ok: false, error: "not_milk", message: "That does not look like a milk bag or bottle." };
  const ml = reading.ml != null && reading.ml > 0 && reading.ml <= 1000 ? Math.round(reading.ml) : null;
  const date = reading.date && /^\d{4}-\d{2}-\d{2}$/.test(reading.date) && reading.date <= today ? reading.date : null;
  return { ok: true, kind: reading.kind, date, source: reading.source, ml, confidence: reading.confidence };
}
