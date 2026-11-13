"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CalendarData, CalendarEvent, DueItem, EventKind } from "@/lib/types";
import { EVENT_KINDS, can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { addDays, fmtDate, fmtTime, fromLocalInput, toLocalInput } from "@/lib/time";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Icon, type IconName } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { Sheet } from "@/components/Sheet";

/** The app's line icons for each kind, not the emoji (EVENT_KINDS keeps those for the helper and /send). */
const KIND_ICON: Record<EventKind, IconName> = {
  event: "calendar",
  plan: "clipboard",
  reminder: "bell",
  routine: "history",
  guest: "users",
  delivery: "inbox",
  contractor: "wrench",
  appointment: "syringe",
};

/** "Today", "Tomorrow", then "Mon 16 Nov" (DESIGN.md, "Numbers, times and dates"). */
function dayLabel(ymd: string, today: string) {
  ymd = ymd.slice(0, 10);
  if (ymd === today) return "Today";
  if (ymd === addDays(today, 1)) return "Tomorrow";
  return fmtDate(`${ymd}T12:00:00Z`, "UTC");
}

/** The fortnight on screen: "13 – 26 Nov", or "30 Nov – 13 Dec" across a month. */
function rangeLabel(from: string, to: string) {
  const day = (ymd: string, opts: Intl.DateTimeFormatOptions = {}) => fmtDate(`${ymd}T12:00:00Z`, "UTC", { weekday: undefined, ...opts });
  return `${from.slice(0, 7) === to.slice(0, 7) ? day(from, { month: undefined }) : day(from)} – ${day(to)}`;
}

export function CalendarView({
  data,
  from,
  today,
  members,
  due = [],
  footer,
}: {
  data: CalendarData;
  from: string;
  today: string;
  members: { id: string; name: string }[];
  /** Treatments and vaccine visits with a due date, shown on their day. */
  due?: DueItem[];
  /** What sits under the days, above the bottom button (the week's draft). */
  footer?: React.ReactNode;
}) {
  const me = useMe();
  const [editing, setEditing] = useState<CalendarEvent | "new" | null>(null);
  const tz = data.timezone;
  const canAdd = can(me, "calendar", "add");
  // Calendar is a tab for staff (Nav.tsx), so no Back for them; everyone else opens it from More.
  const staff = !can(me, "lana", "view");
  const byDay = new Map<string, CalendarEvent[]>();
  // A daily routine is said once, on its first day in these two weeks ("Bath time · daily");
  // repeated on every day it filled two weeks with the same line. One that starts later in
  // the range is said on the day it starts.
  const saidDaily = new Set<string>();
  for (const e of [...data.events].sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    if (e.repeat === "daily") {
      if (saidDaily.has(e.id)) continue;
      saidDaily.add(e.id);
    }
    byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  }

  const shownDays = data.days.filter((day) => day.date.slice(0, 10) === today.slice(0, 10) || (byDay.get(day.date)?.length ?? 0) > 0 || due.some((d) => d.due_on === day.date.slice(0, 10)));
  return (
    <div className="flex flex-col gap-4">
      {/* The fortnight on the line under the title, its two arrows together on the right, so no
          arrow sits under Back on the left edge where it could be taken for it. */}
      <PageHeader
        back={staff ? undefined : "/me"}
        title="Calendar"
        subtitle={rangeLabel(from, addDays(from, 13))}
        action={
          <>
            <Link prefetch={false} href={`/calendar?d=${addDays(from, -14)}`} className="icon-btn" aria-label="Two weeks earlier">
              <Icon name="back" size={22} />
            </Link>
            <Link prefetch={false} href={`/calendar?d=${addDays(from, 14)}`} className="icon-btn ml-0 -mr-2" aria-label="Two weeks later">
              <Icon name="forward" size={22} />
            </Link>
          </>
        }
      />

      {/* Adding or changing opens a sheet over wherever the list is (DESIGN.md, "Sheet"): the
          Add button sits at the bottom, so a form at the top would open out of sight. */}
      {editing && (
        <Sheet title={editing === "new" ? "New calendar entry" : "Change calendar entry"} onClose={() => setEditing(null)}>
          <EventForm
            event={editing === "new" ? null : editing}
            members={members}
            tz={tz}
            defaultDate={from}
            onClose={() => setEditing(null)}
          />
        </Sheet>
      )}

      {/* Only the days with something on (and today): two weeks of empty days said nothing.
          Each day is a label over one white list of rows (DESIGN.md, "List rows"), as on More. */}
      {shownDays.length === 0 && <p className="muted px-1">Nothing planned in these two weeks.</p>}
      {shownDays.map((day) => {
        const ymd = day.date.slice(0, 10);
        const events = byDay.get(day.date) ?? [];
        const dueToday = due.filter((d) => d.due_on === ymd);
        return (
          <section key={day.date} className="flex flex-col gap-2" aria-labelledby={`d-${ymd}`}>
            <h2 id={`d-${ymd}`} className="section-title">
              {dayLabel(day.date, today)}
            </h2>
            {dueToday.map((d) => (
              <Link prefetch={false} key={d.label + d.due_at} href={d.kind === "vaccine" ? "/baby/vaccines" : "/baby"} className={`notice ${d.overdue ? "notice-danger" : "notice-warn"} block text-sm font-semibold`}>
                {d.subject}: {d.label} due{d.overdue ? " (overdue)" : ""}
              </Link>
            ))}
            {events.length === 0 ? (
              dueToday.length === 0 && <p className="muted px-1">Nothing planned.</p>
            ) : (
              <ul className="card flex flex-col p-0">
                {events.map((e) => {
                  const k = EVENT_KINDS.find((x) => x.id === e.kind);
                  const mine = e.created_by === me.member.id;
                  const editable = can(me, "calendar", "edit") || (mine && canAdd);
                  const inner = (
                    <>
                      <span className="icon-disc size-8 tint-cal">
                        <Icon name={KIND_ICON[e.kind] ?? "calendar"} size={17} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{e.title}</span>
                        <span className="muted block text-sm">
                          {e.all_day ? "All day" : fmtTime(e.starts_at, tz)}
                          {!e.all_day && e.ends_at ? `–${fmtTime(e.ends_at, tz)}` : ""}
                          {k ? ` · ${k.label}` : ""}
                          {e.assigned_name ? ` · ${e.assigned_name}` : ""}
                          {e.visibility === "family" ? " · family only" : ""}
                          {e.repeat !== "none" ? ` · ${e.repeat}` : ""}
                          {e.note ? ` · ${e.note}` : ""}
                        </span>
                      </span>
                    </>
                  );
                  // The whole row is the tap target when it can be changed; otherwise it only reads.
                  return (
                    <li key={e.id + e.starts_at} className="row px-4 py-0">
                      {editable ? (
                        <button type="button" className="row-link flex w-full items-center gap-3 py-3 text-left" onClick={() => setEditing(e)}>
                          {inner}
                        </button>
                      ) : (
                        <div className="flex w-full items-center gap-3 py-3">{inner}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
      {footer}
      {canAdd && (
        <div className="bottom-action">
          <button type="button" className="btn btn-primary btn-lg w-full" onClick={() => setEditing("new")}>
            + Add to the calendar
          </button>
        </div>
      )}
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
  const [confirmDelete, setConfirmDelete] = useState(false);
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
    if (!event) return;
    // Destroying is a word and a second tap, never a pop-up (DESIGN.md, rule 8; as EntrySheet).
    if (!confirmDelete) return setConfirmDelete(true);
    setBusy(true);
    const { data } = await supabaseBrowser().rpc("calendar_remove", { p_id: event.id });
    setBusy(false);
    const res = data as { ok: boolean; message?: string } | null;
    if (!res?.ok) return setMsg(res?.message ?? "Could not delete.");
    onClose();
    router.refresh();
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="font-semibold">What</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. Plumber for the kitchen tap" />
      </label>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Kind">
        {EVENT_KINDS.map((k) => (
          <button key={k.id} type="button" className="chip" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
            <Icon name={KIND_ICON[k.id]} size={18} />
            {k.label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-3">
        <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
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
        <button type="button" className="btn btn-danger" onClick={() => void remove()} disabled={busy}>
          {confirmDelete ? "Tap again to delete" : "Delete"}
        </button>
      )}
    </form>
  );
}
