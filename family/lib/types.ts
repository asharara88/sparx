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
  name: string;
  timezone: string;
  currency: string;
  /** Things the family knows that the log does not show. The assistant reads them. */
  notes?: string | null;
  /** How much pumped milk the family wants in the fridge for the day. */
  milk_target_ml?: number;
  /** Minutes between bottles while Mama is at work. */
  bottle_interval_min?: number;
}

export interface Me {
  ok: true;
  /** True while an admin is viewing the app as this member (read only). */
  preview?: boolean;
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
  reorder_days_learned: number | null;
  substitution: Substitution;
  purchases: number;
  aliases: string[];
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
  receipts_to_check: number;
  open_carts: number;
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

// ---- Step 3: Fanta, attachments, the house ---------------------------------
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
export type TicketStatus = "open" | "in_progress" | "waiting" | "done";
export const TICKET_STATUS: { id: TicketStatus; label: string; icon: string; tone: "danger" | "warn" | "accent" | "ok" }[] = [
  { id: "open", label: "Open", icon: "🔴", tone: "danger" },
  { id: "in_progress", label: "In progress", icon: "🟠", tone: "warn" },
  { id: "waiting", label: "Waiting", icon: "🟡", tone: "accent" },
  { id: "done", label: "Done", icon: "✅", tone: "ok" },
];
export interface Ticket {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  status: TicketStatus;
  priority: "low" | "normal" | "urgent";
  asset_id: string | null;
  asset_name: string | null;
  contractor_id: string | null;
  contractor_name: string | null;
  contractor_phone?: string | null;
  opened_by: string | null;
  opened_by_name: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  photo_path?: string | null;
  updates?: number;
  cost_total?: number | null;
}
export interface TicketUpdate {
  id: string;
  note: string | null;
  status: TicketStatus | null;
  photo_path: string | null;
  created_at: string;
  by_name: string | null;
}
export interface TicketCost {
  id: string;
  amount: number;
  currency: string;
  paid_on: string | null;
  note: string | null;
  paid_by_name: string | null;
}
export interface TicketDetail {
  ok: true;
  costs_visible: boolean;
  ticket: Ticket;
  updates: TicketUpdate[];
  costs: TicketCost[] | null;
}
export const ASSET_CATEGORIES: { id: string; label: string; icon: string }[] = [
  { id: "appliance", label: "Appliance", icon: "🔌" },
  { id: "ac", label: "AC", icon: "❄️" },
  { id: "plumbing", label: "Plumbing", icon: "🚰" },
  { id: "electrical", label: "Electrical", icon: "💡" },
  { id: "furniture", label: "Furniture", icon: "🛋️" },
  { id: "electronics", label: "Electronics", icon: "📺" },
  { id: "vehicle", label: "Vehicle", icon: "🚗" },
  { id: "other", label: "Other", icon: "📦" },
];
export interface Asset {
  id: string;
  name: string;
  category: string;
  location: string | null;
  brand: string | null;
  model: string | null;
  serial: string | null;
  purchased_on: string | null;
  warranty_until: string | null;
  supplier: string | null;
  notes: string | null;
  label_path: string | null;
  is_active: boolean;
  open_tickets: number;
}
export interface Contractor {
  id: string;
  name: string;
  trade: string | null;
  phone: string | null;
  whatsapp: string | null;
  company: string | null;
  notes: string | null;
  rating: number | null;
  is_active: boolean;
  jobs: number;
  last_job: string | null;
}
export interface MaintenanceOverview {
  ok: true;
  open: number;
  urgent: number;
  assets: number;
  contractors: number;
  costs_visible: boolean;
  recent: Pick<Ticket, "id" | "title" | "status" | "priority" | "location" | "created_at">[];
}

// ---- Step 4: the assistant ------------------------------------------------
export type ProposalKind = "care_entry" | "calendar_event" | "shopping" | "memory";

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

export interface ShoppingProposal {
  /** An existing list item to mark as needed, or null to add / request a new one. */
  item_id: string | null;
  item_name: string;
  note: string | null;
  /** needed: tick an existing item · new: add to the list · request: Lilly's queue */
  via: "needed" | "new" | "request";
}

/** Something the assistant wants to save. Nothing is written until the member taps Confirm. */
export interface AssistantProposal {
  id: string;
  kind: ProposalKind;
  summary: string;
  care_entry?: CareEntryProposal;
  calendar_event?: CalendarEventProposal;
  shopping?: ShoppingProposal;
  /** A fact for the helper to keep ("Lana takes a bottle better when it is warm"). */
  memory?: { body: string };
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
}

export interface Brief {
  id: string;
  day: string;
  kind: "morning" | "evening";
  content: string;
  created_at: string;
  model: string | null;
  refs?: Record<string, AssistantRef>;
}

// ---- Step 5: the shopping loop ---------------------------------------------
export type Substitution = "none" | "same_brand" | "any_brand";
export const SUBSTITUTIONS: { id: Substitution; label: string; hint: string }[] = [
  { id: "same_brand", label: "Same brand only", hint: "Another size of the same brand is fine; no other brand." },
  { id: "any_brand", label: "Any brand", hint: "Same thing, any brand, same size or close." },
  { id: "none", label: "Exactly this", hint: "Only this product. Otherwise leave it out." },
];

export type ReceiptStatus = "new" | "read" | "applied" | "discarded";
export type LineMatch = "auto" | "confirmed" | "added" | "skipped" | "unmatched";

export interface Receipt {
  id: string;
  store_id: string | null;
  store_name: string | null;
  store_label: string | null;
  bought_on: string | null;
  total: number | null;
  currency: string | null;
  photo_path: string;
  status: ReceiptStatus;
  note: string | null;
  created_at: string;
  created_by_name: string | null;
  applied_at: string | null;
}

export interface ReceiptLine {
  id: string;
  line_no: number;
  text: string;
  qty: number | null;
  unit_price: number | null;
  line_total: number | null;
  item_id: string | null;
  item_name: string | null;
  match: LineMatch;
  confidence: number | null;
}

export interface ReceiptDetail {
  ok: true;
  receipt: Receipt;
  lines: ReceiptLine[];
}

export interface ReceiptRow {
  id: string;
  store: string | null;
  bought_on: string | null;
  total: number | null;
  currency: string | null;
  status: ReceiptStatus;
  created_at: string;
  photo_path: string;
  lines: number;
  unmatched: number;
}

export interface Purchase {
  id: string;
  bought_on: string;
  store: string | null;
  qty: number | null;
  price: number | null;
  receipt_id: string | null;
  line: string | null;
}

export interface CartManifestItem {
  item_id: string;
  name: string;
  size: string | null;
  quantity: number;
  product_url: string | null;
  last_price: number | null;
  substitution: Substitution;
  note: string | null;
  aliases: string[];
}

export interface CartManifest {
  store: { id: string; label: string; url: string | null };
  currency: string;
  rules: { stop_at_checkout: true; never_pay: true; report: string };
  items: CartManifestItem[];
}

export type CartResult = "found" | "substituted" | "missing";
export interface CartReportItem {
  item_id: string;
  result: CartResult;
  product?: string | null;
  price?: number | null;
  note?: string | null;
}
export interface CartReport {
  summary: string | null;
  items: CartReportItem[];
}

export type CartStatus = "prepared" | "reported" | "done" | "cancelled";
export interface CartRun {
  id: string;
  store_id: string;
  store_label: string;
  store_url: string | null;
  status: CartStatus;
  manifest: CartManifest;
  report: CartReport | null;
  note: string | null;
  created_at: string;
  created_by_name: string | null;
  reported_at: string | null;
  done_at: string | null;
}

export interface CartRunRow {
  id: string;
  store_label: string;
  status: CartStatus;
  created_at: string;
  items: number;
  found: number;
  substituted: number;
  missing: number;
}

// ---- Step 6: the proactive layer -------------------------------------------
export type SuggestionKind = "reorder" | "due" | "plan" | "request" | "ticket";
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

export interface HubEntity {
  entity_id: string;
  label: string;
  kind: "sensor" | "binary" | "camera" | "other";
  sort: number;
  is_active: boolean;
}
export interface HubState {
  entity_id: string;
  label: string;
  kind: HubEntity["kind"];
  state: string;
  unit: string | null;
  last_changed: string | null;
  attributes?: Record<string, unknown>;
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

export interface Routine {
  id: string;
  label: string;
  every_days: number;
  type_id: string | null;
  payload: Record<string, unknown>;
  last_done: string | null;
  due_on: string | null;
  days_left: number | null;
  sort: number;
  is_active: boolean;
}
export interface RoutinesData {
  ok: true;
  today: string;
  routines: Routine[];
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
