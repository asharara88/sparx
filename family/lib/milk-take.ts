/**
 * Where a bottle's milk comes out of the stash (Mido, 10 November): one rule for Home's
 * bottle sheet, the helper's cards and the quick logs alike. A bottle of "Freezer" milk
 * takes the oldest bag out of the freezer; a pumped milk ("Morning pumped", "Night pumped")
 * comes out of the fridge; formula, or a bottle with no milk named, takes nothing (the app
 * cannot know, and a wrong guess makes the fridge count lie). Pure: no "@/" imports.
 */
export function milkSource(payload: Record<string, unknown>): "fridge" | "freezer" | null {
  if (payload.method !== "Bottle" || !(Number(payload.amount_ml) > 0)) return null;
  const milk = typeof payload.milk === "string" ? payload.milk.trim() : "";
  if (!milk || /formula/i.test(milk)) return null;
  return /freez|frozen/i.test(milk) ? "freezer" : "fridge";
}

/** "The freezer was 40 ml short." when the stash did not hold the whole bottle; null when it did. */
export function shortLine(where: "fridge" | "freezer", shortMl: number): string | null {
  return shortMl > 0 ? `The ${where} was ${shortMl} ml short.` : null;
}
