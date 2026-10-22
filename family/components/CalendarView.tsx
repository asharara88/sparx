"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CalendarData, CalendarEvent, DueItem, EventKind } from "@/lib/types";
import { EVENT_KINDS, can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { addDays, fmtTime, fromLocalInput, toLocalInput } from "@/lib/time";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Icon } from "@/components/Icon";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dayLabel(ymd: string, today: string) {
  ymd = ymd.slice(0, 10);
  if (ymd === today) return "Today";
  if (ymd === addDays(today, 1)) return "Tomorrow";
  const d = new Date(ymd.slice(0, 10) + "T12:00:00Z");
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

export function CalendarView({
  data,
  from,
  today,
  members,
  due = [],
}: {
  data: CalendarData;
  from: string;
  today: string;
  members: { id: string; name: string }[];
  /** Treatments and vaccine visits with a due date, shown on their day. */
  due?: DueItem[];
}) {
  const me = useMe();
  const [editing, setEditing] = useState<CalendarEvent | "new" | null>(null);
  const tz = data.timezone;
  const canAdd = can(me, "calendar", "add");
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of data.events) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);

  return (
    <div className="flex flex-col gap-4">
      <header className="page-header flex items-center justify-between gap-2">
        <Link href={`/calendar?d=${addDays(from, -14)}`} className="icon-btn" aria-label="Earlier">
          <Icon name="back" size={24} />
        </Link>
        <h1 className="page-title">Calendar</h1>
        <Link href={`/calendar?d=${addDays(from, 14)}`} className="icon-btn" aria-label="Later">
          <Icon name="forward" size={24} />
        </Link>
      </header>

      {canAdd && (
        <button className="btn btn-primary min-h-[64px] text-lg" onClick={() => setEditing("new")}>
          + Add to the calendar
        </button>
      )}

      {editing && (
        <EventForm
          event={editing === "new" ? null : editing}
          members={members}
          tz={tz}
          defaultDate={from}
          onClose={() => setEditing(null)}
        />
      )}

      {data.days.map((day) => {
        const events = byDay.get(day.date) ?? [];
        const guestDay = events.some((e) => e.kind === "guest");
        return (
          <section key={day.date} className="card" aria-labelledby={`d-${day.date}`}>
            <h2 id={`d-${day.date}`} className="text-lg font-bold">
              {dayLabel(day.date, today)}
            </h2>
            <p className="muted text-sm">
              Home: {day.in_house.length ? day.in_house.join(", ") : "nobody marked"}
              {day.working.length ? ` · Working: ${day.working.join(", ")}` : ""}
            </p>
            {guestDay && <p className="mt-1 text-sm font-semibold text-[var(--warn)]">Guest day. No contractor visits.</p>}
            {due
              .filter((d) => d.due_on === day.date.slice(0, 10))
              .map((d) => (
                <Link key={d.label + d.due_at} href={d.kind === "vaccine" ? "/baby/vaccines" : "/baby"} className={`notice ${d.overdue ? "notice-danger" : "notice-warn"} mt-2 block text-sm font-semibold`}>
                  {d.subject}: {d.label} due{d.overdue ? " (overdue)" : ""}
                </Link>
              ))}
            {events.length === 0 ? (
              <p className="muted mt-2">Nothing planned.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {events.map((e) => {
                  const k = EVENT_KINDS.find((x) => x.id === e.kind);
                  const mine = e.created_by === me.member.id;
                  const editable = can(me, "calendar", "edit") || (mine && canAdd);
                  return (
                    <li key={e.id + e.starts_at}>
                      <button
                        className="card-flat w-full rounded-xl p-3 text-left"
                        onClick={() => editable && setEditing(e)}
                        disabled={!editable}
                      >
                        <span className="block font-semibold">
                          <span aria-hidden>{k?.icon} </span>
                          {e.all_day ? "All day" : fmtTime(e.starts_at, tz)}
                          {!e.all_day && e.ends_at ? `–${fmtTime(e.ends_at, tz)}` : ""} · {e.title}
                        </span>
                        <span className="muted block text-sm">
                          {k?.label}
                          {e.assigned_name ? ` · ${e.assigned_name}` : ""}
                          {e.visibility === "family" ? " · family only" : ""}
                          {e.repeat !== "none" ? ` · ${e.repeat}` : ""}
                          {e.note ? ` · ${e.note}` : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function EventForm({
  event,
  members,
  tz,
  defaultDate,
  onClose,
}: {
  event: CalendarEvent | null;
  members: { id: string; name: string }[];
  tz: string;
  defaultDate: string;
  onClose: () => void;
}) {
  const me = useMe();
  const router = useRouter();
  const [title, setTitle] = useState(event?.title ?? "");
  const [kind, setKind] = useState<EventKind>(event?.kind ?? "event");
  const [allDay, setAllDay] = useState(event?.all_day ?? false);
  const [starts, setStarts] = useState(event ? toLocalInput(event.starts_at, tz) : `${defaultDate}T10:00`);
  const [ends, setEnds] = useState(event?.ends_at ? toLocalInput(event.ends_at, tz) : "");
  const [visibility, setVisibility] = useState<"household" | "family">(event?.visibility ?? "household");
  const [assigned, setAssigned] = useState(event?.assigned_to ?? "");
  const [note, setNote] = useState(event?.note ?? "");
  const [repeat, setRepeat] = useState<"none" | "daily" | "weekly">(event?.repeat ?? "none");
  const [until, setUntil] = useState(event?.repeat_until ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const staffKind = kind === "guest" || kind === "delivery" || kind === "contractor";
  const canFamily = can(me, "calendar_family", "add");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("calendar_save", {
      p_id: event?.id ?? null,
      p_title: title,
      p_kind: kind,
      p_starts_at: fromLocalInput(allDay ? starts.slice(0, 10) + "T00:00" : starts, tz),
      p_ends_at: !allDay && ends ? fromLocalInput(ends, tz) : null,
      p_all_day: allDay,
      p_visibility: staffKind ? "household" : visibility,
      p_assigned_to: assigned || null,
      p_note: note || null,
      p_repeat: repeat,
      p_repeat_until: repeat !== "none" && until ? until : null,
    });
    setBusy(false);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    onClose();
    router.refresh();
  }

  async function remove() {
    if (!event || !confirm("Remove this from the calendar?")) return;
    setBusy(true);
    const { data } = await supabaseBrowser().rpc("calendar_remove", { p_id: event.id });
    setBusy(false);
    const res = data as { ok: boolean; message?: string } | null;
    if (!res?.ok) return setMsg(res?.message ?? "Could not remove.");
    onClose();
    router.refresh();
  }

  return (
    <form onSubmit={save} className="card flex flex-col gap-3 border-[var(--accent)]">
      <h2 className="text-lg font-semibold">{event ? "Change" : "New"} calendar entry</h2>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">What</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. Plumber for the kitchen tap" />
      </label>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Kind">
        {EVENT_KINDS.map((k) => (
          <button key={k.id} type="button" className="chip" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
            <span aria-hidden>{k.icon} </span>
            {k.label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-3">
        <input type="checkbox" className="h-7 w-7" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
        <span className="font-semibold">All day</span>
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="font-semibold">{allDay ? "Day" : "Start"}</span>
          <input className="input" type={allDay ? "date" : "datetime-local"} value={allDay ? starts.slice(0, 10) : starts} onChange={(e) => setStarts(allDay ? e.target.value + "T00:00" : e.target.value)} required />
        </label>
        {!allDay && (
          <label className="flex flex-col gap-1">
            <span className="font-semibold">End (optional)</span>
            <input className="input" type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} />
          </label>
        )}
      </div>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">For whom (optional)</span>
        <select className="input" value={assigned} onChange={(e) => setAssigned(e.target.value)}>
          <option value="">Everyone</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      {!staffKind && canFamily && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Who can see it">
          <button type="button" className="chip" aria-pressed={visibility === "household"} onClick={() => setVisibility("household")}>
            Whole household
          </button>
          <button type="button" className="chip" aria-pressed={visibility === "family"} onClick={() => setVisibility("family")}>
            Family only
          </button>
        </div>
      )}
      {staffKind && <p className="muted text-sm">Guests, deliveries and contractor visits are always shown to staff.</p>}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Repeat">
        {(["none", "daily", "weekly"] as const).map((r) => (
          <button key={r} type="button" className="chip" aria-pressed={repeat === r} onClick={() => setRepeat(r)}>
            {r === "none" ? "Once" : r === "daily" ? "Every day" : "Every week"}
          </button>
        ))}
      </div>
      {repeat !== "none" && (
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Until (optional)</span>
          <input className="input" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
      )}
      <label className="flex flex-col gap-1">
        <span className="font-semibold">Note (optional)</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {msg && (
        <p role="alert" className="notice notice-danger">
          {msg}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <button type="button" className="btn" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      {event && (can(me, "calendar", "delete") || event.created_by === me.member.id) && (
        <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
          Remove
        </button>
      )}
    </form>
  );
}
