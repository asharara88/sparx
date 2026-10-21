import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { todayYmd } from "@/lib/time";
import { assistantConfigured, MODEL } from "@/lib/assistant/run";
import { anthropicApiKey, anthropicOptions } from "@/lib/server/anthropic";

/**
 * Read a receipt photo into lines. The model does the reading (it is far better
 * at receipts than on-phone OCR); the database does the matching and keeps the
 * raw reading, so nothing is dropped silently. Runs with the member's session.
 */

export const ReceiptSchema = z.object({
  is_receipt: z.boolean().describe("false if the photo is not a shop receipt or cannot be read at all"),
  store: z.string().nullable().describe("Shop as printed; for an order placed through an app, the merchant then the platform in brackets, e.g. 'MLS Gourmet Butcher (Talabat)', 'Amazon Fresh (Amazon)', 'talabat mart (Talabat)'"),
  date: z.string().nullable().describe("Purchase date as YYYY-MM-DD"),
  currency: z.string().nullable().describe("Currency code or symbol as printed, e.g. AED"),
  total: z.number().nullable().describe("The amount paid, as printed"),
  lines: z.array(
    z.object({
      text: z.string().describe("The product line exactly as printed"),
      qty: z.number().nullable().describe("Quantity bought; null if not printed (means 1)"),
      unit_price: z.number().nullable(),
      line_total: z.number().nullable(),
      item_id: z.string().nullable().describe("The id of the household list item this line clearly is, else null"),
    }),
  ),
});
export type ReceiptReading = z.infer<typeof ReceiptSchema>;

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic(anthropicOptions({ timeout: 90_000 }));
  return _client;
}

function mediaType(path: string, blobType: string): "image/jpeg" | "image/png" | "image/webp" | "image/gif" {
  const t = blobType.toLowerCase();
  if (t === "image/png" || t === "image/webp" || t === "image/gif") return t;
  if (t === "image/jpeg") return t;
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/jpeg";
}

export async function readReceipt(supabase: SupabaseClient, me: Me, receiptId: string): Promise<{ ok: true; lines: number; matched: number; is_receipt: boolean } | RpcError> {
  if (!can(me, "shopping", "add")) return { ok: false, error: "not_allowed", message: "You are not allowed to add receipts." };
  if (!assistantConfigured()) return { ok: false, error: "not_configured", message: "Receipt reading is not set up yet (no ANTHROPIC_API_SECRET_KEY on the server)." };

  const { data: got } = await supabase.rpc("receipt_get", { p_id: receiptId });
  const detail = got as { ok: boolean; receipt?: { photo_path: string; status: string } } | null;
  if (!detail?.ok || !detail.receipt) return { ok: false, error: "not_found", message: "Receipt not found." };
  if (detail.receipt.status === "applied") return { ok: false, error: "applied", message: "This receipt was already applied." };

  const { data: blob, error: dlErr } = await supabase.storage.from("photos").download(detail.receipt.photo_path);
  if (dlErr || !blob) return { ok: false, error: "no_photo", message: "Could not load the photo." };
  const data = Buffer.from(await blob.arrayBuffer()).toString("base64");

  const { data: listData } = await supabase.rpc("shopping_list");
  const items = ((listData as { items?: { id: string; name: string; size: string | null; aliases: string[] }[] } | null)?.items ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    size: i.size ?? undefined,
    also: i.aliases?.length ? i.aliases.slice(0, 5) : undefined,
  }));
  const today = todayYmd(me.household.timezone);

  const t0 = Date.now();
  const res = await client().beta.messages.parse({
    model: MODEL,
    max_tokens: 4096,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(ReceiptSchema) },
    system:
      `You read shop receipts and order-page screenshots (for example Talabat, Amazon, Noon, Carrefour) for a household whose currency is ${me.household.currency} and whose timezone is ${me.household.timezone}. Be exact: copy product lines as printed, never invent a line, never merge lines. Amounts are numbers. Skip subtotal, VAT, discount, loyalty, payment, change and balance lines; keep only product lines. If a quantity like '2 x 12.50' is printed, qty is 2 and unit_price 12.50.`,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType(detail.receipt.photo_path, blob.type), data } },
          {
            type: "text",
            text: `Read this receipt. Today is ${today}; if the receipt shows only day and month, assume this year. For each product line, give item_id only when the printed line clearly is one of the household's list items below (same product; a different brand or a different product is null):\n${JSON.stringify(items)}`,
          },
        ],
      },
    ],
  });
  const reading = res.parsed_output;
  const usage = { model: MODEL, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens, cache_read: res.usage.cache_read_input_tokens ?? 0, ms: Date.now() - t0 };

  if (res.stop_reason === "refusal" || !reading) {
    await audit(supabase, receiptId, "could not read", usage);
    return { ok: false, error: "unreadable", message: "I could not read this receipt. Try a flatter, brighter photo." };
  }
  const extracted = {
    store: reading.store,
    date: reading.date,
    currency: reading.currency,
    total: reading.total,
    lines: reading.is_receipt ? reading.lines : [],
  };
  const { data: set, error } = await supabase.rpc("receipt_set_lines", { p_id: receiptId, p_extracted: extracted });
  const r = set as { ok: boolean; lines?: number; matched?: number; message?: string } | null;
  await audit(supabase, receiptId, `${r?.lines ?? 0} lines, ${r?.matched ?? 0} matched`, usage);
  if (error || !r?.ok) return { ok: false, error: "save_failed", message: r?.message ?? error?.message ?? "Could not save the reading." };
  return { ok: true, lines: r.lines ?? 0, matched: r.matched ?? 0, is_receipt: reading.is_receipt };
}

async function audit(supabase: SupabaseClient, receiptId: string, answer: string, usage: Record<string, unknown>) {
  try {
    await supabase.rpc("assistant_audit", { p_kind: "receipt", p_question: `read receipt ${receiptId}`, p_answer: answer, p_usage: usage });
  } catch {
    /* best effort */
  }
}
