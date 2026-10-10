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
}

export interface Subject {
  id: string;
  module_id: string;
  kind: "child" | "pet";
  name: string;
  birth_date: string | null;
  profile: Record<string, unknown>;
  settings: Record<string, unknown>;
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
