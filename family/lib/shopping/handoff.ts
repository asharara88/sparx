import type { CartManifest, Substitution } from "@/lib/types";

const RULE: Record<Substitution, string> = {
  none: "exactly this product; if it is not available, leave it out and report it missing",
  same_brand: "the same brand; another pack size of the same brand is fine, a different brand is not",
  any_brand: "the same kind of product from any brand, same size or close",
};

/**
 * The text handed to the cart agent (Claude in Chrome, or whoever drives the
 * browser). Deterministic from the manifest, so the same run produces the same
 * instructions. It never contains payment details and tells the agent to stop
 * at checkout.
 */
export function handoffText(m: CartManifest, runId: string): string {
  const lines: string[] = [];
  lines.push(`Fill a shopping cart on ${m.store.label}${m.store.url ? ` (${m.store.url})` : ""} for our household. Stop at the checkout page: do NOT place the order, do NOT enter or confirm any payment or address details.`);
  lines.push("");
  lines.push("Add these items, one of each unless a quantity is given:");
  m.items.forEach((it, i) => {
    const bits = [`${i + 1}. ${it.name}`];
    if (it.size) bits.push(`size/pack: ${it.size}`);
    if (it.quantity && it.quantity !== 1) bits.push(`quantity: ${it.quantity}`);
    if (it.product_url) bits.push(`product page: ${it.product_url}`);
    if (it.last_price != null) bits.push(`last paid about ${it.last_price} ${m.currency}`);
    if (it.aliases?.length) bits.push(`also appears as: ${it.aliases.slice(0, 3).join(" / ")}`);
    if (it.note) bits.push(`note: ${it.note}`);
    bits.push(`substitution: ${RULE[it.substitution] ?? RULE.same_brand}`);
    lines.push(bits.join(" — "));
  });
  lines.push("");
  lines.push("Rules: prefer the product page link when given. If a price is more than about 50% above the last paid price, do not add it; report it instead. Never buy more than listed. Never use a saved card, never place the order.");
  lines.push("");
  lines.push(`When the cart is ready, stop and report back in this exact form, one line per item, in the order above (run ${runId}):`);
  lines.push("<number>. <item name> — FOUND | SUBSTITUTED (what you chose instead) | MISSING (why) — price <amount>");
  lines.push("Then one line: CART TOTAL <amount>.");
  return lines.join("\n");
}
