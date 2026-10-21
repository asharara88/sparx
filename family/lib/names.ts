/**
 * Who the app is about. The child's name comes from the database
 * (care_subjects, carried on me().subjects), never from code, so the same build
 * serves any household. Pure functions, testable without React.
 */
import type { Me, SubjectName } from "./types";

type Named = Pick<Me, "subjects">;

export function child(me: Named | null | undefined): SubjectName | null {
  return me?.subjects?.find((s) => s.kind === "child") ?? null;
}

/** The child's name, in the member's language when the household gave one. */
export function childName(me: Named | null | undefined, lang?: string | null): string {
  const c = child(me);
  if (!c) return "the baby";
  return (lang && c.names?.[lang]) || c.name;
}

/** "Lana's", "James'". */
export function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

export interface Pronouns {
  /** she / he / they */
  they: string;
  /** her / him / them */
  them: string;
  /** her / his / their */
  their: string;
  /** is / is / are */
  is: string;
}

/** English pronouns for a subject from its recorded sex; they/them when unknown. */
export function pronouns(sex: string | null | undefined): Pronouns {
  const s = (sex ?? "").toLowerCase();
  if (s === "girl" || s === "female" || s === "f") return { they: "she", them: "her", their: "her", is: "is" };
  if (s === "boy" || s === "male" || s === "m") return { they: "he", them: "him", their: "his", is: "is" };
  return { they: "they", them: "them", their: "their", is: "are" };
}

export function childPronouns(me: Named | null | undefined): Pronouns {
  return pronouns(child(me)?.sex);
}

/** Capitalise the first letter: "she" → "She". */
export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
