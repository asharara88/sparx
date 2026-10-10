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
  name: string;
  timezone: string;
  currency: string;
}

export interface Me {
  ok: true;
  member: Member;
  role: Role;
  permissions: PermissionMap;
  presence: Presence | null;
  work_days: number[];
  household: Household;
}

export interface RpcError {
  ok: false;
  error: string;
  message?: string;
}

export type FieldType = "choice" | "number" | "text";
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
  return !!me?.permissions?.[module]?.[action];
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

// ---- Step 2: shopping -------------------------------------------------------
export const CATEGORIES = [
  { id: "groceries", label: "Groceries", icon: "🛒" },
  { id: "baby", label: "Lana", icon: "👶" },
  { id: "cat", label: "Fanta", icon: "🐈" },
  { id: "home", label: "Home", icon: "🏠" },
  { id: "adult", label: "Supplements", icon: "💪" },
] as const;
export type Category = (typeof CATEGORIES)[number]["id"];

export interface Store {
  id: string;
  label: string;
  url: string | null;
  sort: number;
}

export interface ShelfItem {
  id: string;
  name: string;
  category: Category;
  emoji: string | null;
  sort: number;
  is_active: boolean;
}

export interface ShoppingItem {
  id: string;
  name: string;
  category: Category;
  needed: boolean;
  owner_member: string | null;
  owner_name: string | null;
  store_id: string | null;
  store_label: string | null;
  product_url: string | null;
  quantity_on_hand: string | null;
  size: string | null;
  size_changed_on: string | null;
  last_bought_on: string | null;
  last_price: number | null;
  last_price_store: string | null;
  reorder_days: number | null;
  note: string | null;
  photo_path: string | null;
  due: string | null;
}

export interface ShoppingData {
  ok: true;
  items: ShoppingItem[];
  shelf: ShelfItem[];
  stores: Store[];
  pending_requests: number;
}

export interface ShoppingRequest {
  id: string;
  item_name: string;
  note: string | null;
  photo_path: string | null;
  status: "pending" | "approved" | "rejected";
  shelf_item_id: string | null;
  category: Category | null;
  emoji: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  item_id: string | null;
}
