import { foodDay, type MealRow } from "@/lib/food-day";
import { range, type Stage } from "@/lib/stage";
import { fmtDate } from "@/lib/time";

/**
 * Food today, on the dashboard once the child eats (lib/stage): one number (meals
 * today, against what is usual at this age), then the week's new foods and the
 * allergens she has had, and the last reaction if there was one. Server-rendered.
 */
export function FoodDay({ meals, dayStartMs, dayEndMs, stage, timezone }: { meals: MealRow[]; dayStartMs: number; dayEndMs: number; stage: Stage; timezone: string }) {
  const f = foodDay(meals, dayStartMs, dayEndMs);
  const usual = stage.meals ? `usually ${range(stage.meals)} a day` : null;
  return (
    <section className="card tint-food flex flex-col gap-2" aria-labelledby="food-day-h">
      <h2 id="food-day-h" className="section-title">Food today</h2>
      <p className="text-2xl font-bold">
        {f.today ? `${f.today} meal${f.today === 1 ? "" : "s"}` : "No meal yet"}
        {usual && <span className="muted text-base font-normal"> · {usual}</span>}
      </p>
      {f.newThisWeek.length > 0 && <p className="text-sm">New this week: {f.newThisWeek.join(", ")}</p>}
      {f.allergens.length > 0 && <p className="text-sm">Allergens tried: {f.allergens.join(", ")}</p>}
      {f.reaction && (
        <p className="text-sm font-semibold">
          A {f.reaction.reaction} after {f.reaction.food}, {fmtDate(f.reaction.at, timezone, { weekday: "long" })}
        </p>
      )}
    </section>
  );
}
