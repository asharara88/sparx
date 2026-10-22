export type Action = "view" | "add" | "edit" | "delete";
export type PermissionMap = Record<string, Partial<Record<Action, boolean>>>;

export interface Member {
  id: string;
  user_id: string | null;
  email: string | null;
  display_name: string;
  role_id: string;
  birth_date: string | null;
  relationship: string | null;
  is_active: boolean;
  breastfeeds: boolean;
  /** Free text the assistant reads: "works 9 to 5, out by 8:30, pumps before leaving". */
  routine?: string | null;
  /** Storage path of the member's photo in the photos bucket. */
  photo_path?: string | null;
  /** Language for the simple screen and the voice helper. */
  lang?: "en" | "ar" | "ru";
  /** The big four-button home screen instead of the full one. */
  simple_mode?: boolean;
  /** Work hours on work days, "08:30:00"; the bottle countdown and the assistant use them. */
  work_from?: string | null;
  work_to?: string | null;
  /** Bigger text; null means "the role decides" (carers and staff get it). */
  large_text?: boolean | null;
}

export interface Role {
  id: string;
  label: string;
  description: string | null;
  sort: number;
}

export interface Module {
  id: string;
  label: string;
  description: string | null;
  sort: number;
}

export interface PresenceState {
  id: string;
  label: string;
  counts_as_in_house: boolean;
  sort: number;
}

export interface Presence {
  id: string;
  member_id: string;
  state_id: string;
  starts_on: string;
  ends_on: string | null;
  note: string | null;
}

export interface Household {
  /** The home's id; one deployment holds many homes (docs/MULTI_HOME.md). */
  id: string;
  name: string;
  timezone: string;
  currency: string;
  /** Things the family knows that the log does not show. The assistant reads them. */
  notes?: string | null;
  /** How much pumped milk the family wants in the fridge for the day. */
  milk_target_ml?: number;
  /** Minutes between bottles while Mama is at work. */
  bottle_interval_min?: number;
  /** Modules switched off for everyone; permissions and data stay, the app just does not show them. */
  hidden_modules?: string[];
}

/** A care subject by name only (no profile), visible to every member whatever their role. */
export interface SubjectName {
  id: string;
  module_id: string;
  kind: "child" | "pet";
  name: string;
  birth_date: string | null;
  /** The name in other languages, e.g. { ar: "لانا", ru: "Лана" }. */
  names: Record<string, string>;
  /** "Girl", "Boy", or null when not set. */
  sex: string | null;
}

export interface Me {
  ok: true;
  /** True while an admin is viewing the app as this member (read only). */
  preview?: boolean;
  /** True in the first home on the deployment, whose admins keep the definitions every home shares. */
  platform?: boolean;
  /** How many homes this account is in; above one, the Me screen offers the switcher. */
  homes?: number;
  member: Member;
  role: Role;
  permissions: PermissionMap;
  presence: Presence | null;
  work_days: number[];
  household: Household;
  /** The child and the pet, by name. Absent from older sessions until the page reloads. */
  subjects?: SubjectName[];
}

export interface RpcError {
  ok: false;
  error: string;
  message?: string;
}

/** One of the homes the signed-in account is in (`my_homes`), the current one first. */
export interface HomeListing {
  household_id: string;
  name: string;
  timezone: string;
  member_id: string;
  display_name: string;
  role_id: string;
  role_label: string;
  current: boolean;
  platform: boolean;
}

export type FieldType = "choice" | "number" | "text" | "date";
export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  quick?: number[];
  step?: number;
  show_if?: Record<string, string>;
  /** Option -> member flag that must be true for the option to show (e.g. Breast -> breastfeeds). */
  option_flags?: Record<string, string>;
  /** What an option is called in another language: lang -> stored value -> label. The stored value stays the same. */
  labels?: Partial<Record<"ar" | "ru", Record<string, string>>>;
  default?: string | number;
}

export interface EntryType {
  id: string;
  module_id: string;
  key: string;
  label: string;
  icon: string | null;
  color: string | null;
  sort: number;
  has_end: boolean;
  due_after_min: number | null;
  fields: FieldDef[];
  show_on_home: boolean;
  is_active: boolean;
  settings: EntryTypeSettings;
}

export interface EntryTypeSettings {
  timer?: boolean;
  timer_label?: string;
  timer_payload?: Record<string, unknown>;
  timer_choice?: { key: string; options: string[] };
  timer_flag?: string;
  end_if?: Record<string, string>;
}

export interface OngoingEntry {
  id: string;
  type_id: string;
  occurred_at: string;
  payload: Record<string, unknown>;
  by: string | null;
}

export interface Subject {
  id: string;
  module_id: string;
  kind: "child" | "pet";
  name: string;
  birth_date: string | null;
  profile: Record<string, unknown>;
  settings: Record<string, unknown> & { night_from?: string; night_to?: string };
}

export interface LastEntry {
  id: string;
  occurred_at: string;
  ended_at: string | null;
  payload: Record<string, unknown>;
  note: string | null;
  by: string | null;
  next_due: string | null;
  /** Feeds only: how full the last feed was, 0 to 1 (same rule as the database). */
  fullness?: number | null;
}

export interface EntryRow {
  id: string;
  type_id: string;
  type_label: string;
  icon: string | null;
  occurred_at: string;
  ended_at: string | null;
  payload: Record<string, unknown>;
  note: string | null;
  by?: string | null;
  logged_by?: string | null;
  logged_by_name?: string | null;
  attributed_to?: string | null;
  attributed_name?: string | null;
}

export interface HomeSummary {
  ok: true;
  today: string;
  timezone: string;
  subject: Subject;
  custody: { member_id: string; name: string | null; since: string } | null;
  types: EntryType[];
  ongoing: OngoingEntry[];
  last: Record<string, LastEntry>;
  today_counts: Record<string, number>;
  today_entries: EntryRow[];
}

export interface HouseholdMember {
  id: string;
  name: string;
  role_id: string;
  relationship: string | null;
  presence: {
    state_id: string;
    label: string;
    in_house: boolean;
    starts_on: string;
    ends_on: string | null;
    note: string | null;
  } | null;
  works_today: boolean;
  work_days: number[];
  work_from?: string | null;
  work_to?: string | null;
  breastfeeds?: boolean;
  photo_path?: string | null;
}

export interface HouseholdToday {
  ok: true;
  today: string;
  timezone: string;
  members: HouseholdMember[];
}

export interface AuditRow {
  id: number;
  at: string;
  actor: string | null;
  actor_role: string | null;
  module_id: string | null;
  action: string | null;
  allowed: boolean;
  source: string;
  target_table: string | null;
  target_id: string | null;
  detail: Record<string, unknown> | null;
}

export function can(me: Me | null, module: string, action: Action): boolean {
  if (!me?.permissions?.[module]?.[action]) return false;
  return !(me.household?.hidden_modules ?? []).includes(module);
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

// ---- Step 2: calendar -------------------------------------------------------
export const EVENT_KINDS = [
  { id: "event", label: "Event", icon: "📌" },
  { id: "plan", label: "Plan", icon: "🗓️" },
  { id: "reminder", label: "Reminder", icon: "⏰" },
  { id: "routine", label: "Routine", icon: "🔁" },
  { id: "guest", label: "Guests", icon: "🍽️" },
  { id: "delivery", label: "Delivery", icon: "📦" },
  { id: "contractor", label: "Contractor visit", icon: "🔧" },
  { id: "appointment", label: "Appointment", icon: "🏥" },
] as const;
export type EventKind = (typeof EVENT_KINDS)[number]["id"];

export interface CalendarEvent {
  id: string;
  title: string;
  kind: EventKind;
  all_day: boolean;
  visibility: "household" | "family";
  starts_at: string;
  ends_at: string | null;
  date: string;
  assigned_to: string | null;
  assigned_name: string | null;
  note: string | null;
  repeat: "none" | "daily" | "weekly";
  repeat_until: string | null;
  created_by: string | null;
  is_occurrence: boolean;
}

export interface CalendarDay {
  date: string;
  in_house: string[];
  working: string[];
}

export interface CalendarData {
  ok: true;
  timezone: string;
  from: string;
  to: string;
  events: CalendarEvent[];
  days: CalendarDay[];
}

// ---- trends (care_daily_stats)
export interface DayStats {
  day: string;
  breast_count: number;
  breast_min: number;
  left_count: number;
  right_count: number;
  bottle_count: number;
  bottle_ml: number;
  pump_ml: number;
  sleep_min: number;
  nap_count: number;
  night_sleep_min: number;
  longest_stretch_min: number;
  night_wakes: number;
  night_feeds: number;
  diapers_wet: number;
  diapers_dirty: number;
  diapers: number;
  weight_kg: number | null;
  length_cm: number | null;
  head_cm: number | null;
  milestones: string[];
}
export interface DailyStats {
  ok: true;
  timezone: string;
  night_from: string;
  night_to: string;
  days: DayStats[];
}

// ---- Step 3: due items and attachments -------------------------------------
export interface DueItem {
  subject_id: string;
  subject: string;
  module_id: string;
  kind: "treatment" | "interval" | "vaccine";
  label: string;
  icon: string | null;
  type_id?: string;
  /** Vaccines: which visit ("4 months") and how many doses are outstanding. */
  visit?: string;
  count?: number;
  due_on?: string;
  due_at: string;
  last_at?: string;
  overdue: boolean;
  entry_id?: string;
}
export interface Attachment {
  id: string;
  path: string;
  caption: string | null;
  ocr_text: string | null;
  created_at: string;
  created_by_name: string | null;
}

// ---- Step 4: the assistant ------------------------------------------------
export type ProposalKind = "care_entry" | "end_timer" | "calendar_event" | "memory" | "forget" | "plan";

/** "She woke up": the running timer the helper found, and when it should end. */
export interface EndTimerProposal {
  entry_id: string;
  subject_name: string;
  type_id: string;
  type_label: string;
  since: string;
  ended_at: string;
}

export interface CareEntryProposal {
  subject_id: string;
  subject_name: string;
  module_id: string;
  type_id: string;
  type_label: string;
  occurred_at: string;
  ended_at: string | null;
  payload: Record<string, unknown>;
  note: string | null;
}

export interface CalendarEventProposal {
  title: string;
  kind: EventKind;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  note: string | null;
}

/** Something the assistant wants to save. Nothing is written until the member taps Confirm. */
export interface AssistantProposal {
  id: string;
  kind: ProposalKind;
  summary: string;
  care_entry?: CareEntryProposal;
  end_timer?: EndTimerProposal;
  calendar_event?: CalendarEventProposal;
  /** A fact for the helper to keep ("the baby takes a bottle better when it is warm"). */
  memory?: { body: string };
  /** A remembered fact to drop, because it is wrong or out of date. */
  forget?: { id: string; body: string };
  /** A short day-by-day coach plan the family can start. */
  plan?: { subject_id: string; subject_name: string; goal: string; steps: { day: number; step: string }[] };
}

/** A citation target: the tool result the answer came from, as a link. */
export interface AssistantRef {
  href: string;
  label: string;
}

export interface AssistantTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AssistantUsage {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read: number;
  cache_write: number;
  ms: number;
  tool_calls: number;
}

export interface AssistantReply {
  ok: true;
  answer: string;
  proposals: AssistantProposal[];
  refs: Record<string, AssistantRef>;
  usage: AssistantUsage;
  /** The skills the answer drew on (routed or loaded), for the "Used:" line. */
  skills: { id: string; title: string }[];
  /** Names of the tools that ran, in order (for the evals; nothing sensitive). */
  tools: string[];
}

export type { AssistantSkill } from "./assistant/skill-types";

/** What the server streams while it answers (NDJSON lines). */
export type AssistantEvent =
  | { type: "status"; text: string }
  | { type: "delta"; text: string }
  | { type: "reset" }
  | { type: "done"; reply: AssistantReply }
  | { type: "error"; error: string; message: string };

export interface Brief {
  id: string;
  day: string;
  kind: "morning" | "evening" | "week" | "story";
  content: string;
  created_at: string;
  model: string | null;
  refs?: Record<string, AssistantRef>;
}

// ---- Step 6: the proactive layer -------------------------------------------
/** The kinds the app still shows. Older rows may carry "reorder", "request" or "ticket" (migration 4400 closed them); the cards skip those. */
export type SuggestionKind = "due" | "plan";
export interface PlanEntry {
  title: string;
  kind: EventKind;
  date: string;
  time: string | null;
  note: string | null;
}
export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  key: string;
  title: string;
  body: string | null;
  href: string | null;
  action: { type: "item_needed"; item_id: string } | { type: "open"; subject_id?: string; module_id?: string } | { type: "plan"; entries: PlanEntry[]; summary?: string } | null;
  status: "open" | "approved" | "dismissed" | "done";
  created_at: string;
}

export interface PushStatus {
  ok: true;
  phones: number;
  recent: { kind: string; title: string; sent_at: string }[];
}


// ---- adopted features (migration 1300) ---------------------------------------------------

export interface VaccineGiven {
  id: string;
  given_on: string;
  place: string | null;
  batch: string | null;
  note: string | null;
  recorded_by: string | null;
}
export interface VaccineItem {
  id: string;
  visit: string;
  vaccine: string;
  dose: number;
  note: string | null;
  due_age_days: number;
  window_days: number;
  due_on: string | null;
  status: "given" | "due" | "overdue" | "upcoming" | "unknown";
  given: VaccineGiven | null;
}
export interface VaccinesData {
  ok: true;
  today: string;
  birth_date: string | null;
  items: VaccineItem[];
}

export interface ChatMessage {
  id: string;
  body: string;
  photo_path: string | null;
  created_at: string;
  author: string | null;
  author_name: string;
  author_photo: string | null;
  mine: boolean;
}
export interface ChatData {
  ok: true;
  messages: ChatMessage[];
}

export interface Note {
  id: string;
  body: string;
  author: string | null;
  author_name: string | null;
  is_private: boolean;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  mine: boolean;
}
export interface NotesData {
  ok: true;
  notes: Note[];
}

export interface AttendanceOpen {
  member_id: string;
  name: string;
  in_at: string;
}
export interface AttendanceVisit extends AttendanceOpen {
  id: string;
  out_at: string | null;
}
export interface AttendanceData {
  ok: true;
  open: AttendanceOpen[];
  today: AttendanceVisit[];
}

export interface MilkBottle {
  id: string;
  amount_ml: number;
  pumped_at: string;
  location: "fridge" | "freezer";
  thawed_at: string | null;
  warmed_at: string | null;
  expires_at: string;
  expired: boolean;
  note: string | null;
}
export interface MilkData {
  ok: true;
  bottles: MilkBottle[];
  fridge_ml: number;
  freezer_ml: number;
  fridge_count: number;
  freezer_count: number;
  target_ml: number;
  bottle_interval_min: number;
}


export interface AskChat {
  id: string;
  member_id: string;
  title: string;
  messages: unknown[];
  created_at: string;
  updated_at: string;
}

export interface BagItem {
  id: string;
  label: string;
  checked: boolean;
  sort: number;
  is_active: boolean;
}

// ---- Parity: medicines, memory, backups, milk reading, forecast ---------------
export interface Medicine {
  id: string;
  name: string;
  dose: string | null;
  min_gap_hours: number;
  note: string | null;
  last_at: string | null;
  last_dose: string | null;
  last_by: string | null;
  next_at: string | null;
  too_soon: boolean;
}
export interface MedicinesData {
  ok: true;
  items: Medicine[];
}

export interface MemoryItem {
  id: string;
  body: string;
  created_at: string;
  by: string | null;
  mine: boolean;
}
export interface MemoryData {
  ok: true;
  items: MemoryItem[];
}

export interface BackupRow {
  id: string;
  path: string;
  size_bytes: number;
  rows: number;
  tables: Record<string, number>;
  photos: number;
  created_at: string;
}

/** What the model read off a milk bag label or a bottle's scale. */
export interface MilkReading {
  kind: "bag" | "bottle" | "none";
  date: string | null;
  source: "morning" | "night" | null;
  ml: number | null;
  confidence: "high" | "low";
}

export interface CoachPlan {
  id: string;
  goal: string;
  steps: { day: number; step: string }[];
  starts_on: string;
  ends_on: string;
  /** 1-based day of the plan today (can exceed days when over). */
  day: number;
  days: number;
  over: boolean;
  today_step: string | null;
  done_today: boolean;
  checkins: { day: string; done: boolean; note: string | null; by: string | null }[];
}
export interface CoachPlanData {
  ok: true;
  plan: CoachPlan | null;
}

export interface Activity {
  id: string;
  title: string;
  how: string;
  why: string;
  source: string;
  band: "now" | "coming";
  from_days: number;
  to_days: number;
  done_on: string | null;
  done_by: string | null;
}
export interface ActivitiesData {
  ok: true;
  age_days: number | null;
  items: Activity[];
}
