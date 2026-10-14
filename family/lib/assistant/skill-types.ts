/**
 * A skill as the database returns it. Lives here (not in lib/types) because the
 * router is a pure module whose unit tests run under Node's type stripping,
 * which cannot resolve the "@/" alias; lib/types re-exports it.
 */
export interface AssistantSkill {
  id: string;
  title: string;
  when: string;
  triggers: string[];
  body: string;
  sources: string;
  always_on: boolean;
  age_from_days: number | null;
  age_to_days: number | null;
  sort: number;
  is_active: boolean;
  version?: number;
  updated_at?: string;
  updated_by?: string | null;
}
