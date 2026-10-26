import type { HouseholdToday, Me } from "@/lib/types";
import { WEEKDAYS } from "@/lib/types";

export function HouseholdCard({ data, me, bare = false }: { data: HouseholdToday; me: Me; bare?: boolean }) {
  const inHouse = data.members.filter((m) => m.presence?.in_house);
  const working = data.members.filter((m) => m.works_today && m.work_days.length > 0);
  const away = data.members.filter((m) => !m.presence?.in_house && m.work_days.length === 0);
  const onlyMe = data.members.length === 1 && data.members[0].id === me.member.id;

  // Inside a fold the fold's bar is the title.
  return (
    <section className={bare ? "" : "card"} aria-labelledby={bare ? undefined : "hh-h"} aria-label={bare ? "Who is home today" : undefined}>
      {!bare && (
        <h2 id="hh-h" className="text-xl font-semibold">
          {onlyMe ? "Today" : "Who is home today"}
        </h2>
      )}
      {onlyMe ? (
        <p className={bare ? "" : "mt-2"}>
          {data.members[0].works_today ? "You are working today." : "You are not working today."}
        </p>
      ) : (
        <>
          <ul className={`flex flex-wrap gap-2 ${bare ? "" : "mt-2"}`}>
            {inHouse.map((m) => (
              <li key={m.id} className="chip">
                {m.name}
                <span className="muted text-sm"> · {m.presence?.label}</span>
              </li>
            ))}
            {inHouse.length === 0 && <li className="muted">Nobody marked as home.</li>}
          </ul>
          {working.length > 0 && (
            <p className="mt-3">
              <span className="font-semibold">Working today:</span> {working.map((m) => m.name).join(", ")}
            </p>
          )}
          {data.members.some((m) => m.work_days.length > 0 && !m.works_today) && (
            <p className="muted mt-1">
              Off today: {data.members.filter((m) => m.work_days.length > 0 && !m.works_today).map((m) => m.name).join(", ")}
            </p>
          )}
          {away.length > 0 && (
            <p className="muted mt-1">
              Away: {away.map((m) => `${m.name}${m.presence?.note ? ` (${m.presence.note})` : ""}`).join("; ")}
            </p>
          )}
          <p className="muted mt-3 text-sm">
            {WEEKDAYS[new Date(data.today + "T12:00:00Z").getUTCDay()]} {data.today}, {data.timezone}
          </p>
        </>
      )}
    </section>
  );
}
