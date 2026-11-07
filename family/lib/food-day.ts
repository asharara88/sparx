/**
 * The dashboard's food card, from a week of meals: how many today, the foods tried
 * for the first time this week, the allergens she has had, and the last reaction.
 * Pure: no "@/" imports, so the unit tests load it on its own.
 */

export interface MealRow {
  occurred_at: string;
  payload: Record<string, unknown>;
}

export interface FoodDay {
  today: number;
  /** Foods marked "first time" this week, newest first, each once. */
  newThisWeek: string[];
  /** Allergens eaten this week, in the order first eaten. */
  allergens: string[];
  /** The latest meal with a reaction this week. */
  reaction: { food: string; reaction: string; at: string } | null;
}

const clean = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function foodDay(meals: MealRow[], dayStartMs: number, dayEndMs: number): FoodDay {
  const asc = [...meals].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  const today = asc.filter((m) => {
    const t = Date.parse(m.occurred_at);
    return t >= dayStartMs && t < dayEndMs;
  }).length;
  const seen = new Set<string>();
  const newThisWeek: string[] = [];
  for (const m of [...asc].reverse()) {
    const food = clean(m.payload.food);
    if (m.payload.new_food !== "Yes" || !food || seen.has(food.toLowerCase())) continue;
    seen.add(food.toLowerCase());
    newThisWeek.push(food.toLowerCase());
  }
  const allergens: string[] = [];
  for (const m of asc) {
    const a = clean(m.payload.allergen);
    if (a && a !== "None" && !allergens.includes(a.toLowerCase())) allergens.push(a.toLowerCase());
  }
  const r = [...asc].reverse().find((m) => clean(m.payload.reaction) && m.payload.reaction !== "None");
  return {
    today,
    newThisWeek,
    allergens,
    reaction: r ? { food: clean(r.payload.food).toLowerCase() || "a meal", reaction: clean(r.payload.reaction).toLowerCase(), at: r.occurred_at } : null,
  };
}
