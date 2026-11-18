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
  /** was / was / were */
  was: string;
  /** The verb's "s": "she naps", "they nap". s / s / "" */
  s: string;
}

/**
 * The child's recorded sex as the app reads it: "girl", "boy" or null for anything else.
 * Case does not matter; nothing else is trimmed or guessed (" girl" and "woman" are null).
 * Pronouns, the growth curves and every sentence the app writes about the child go through it.
 */
export function sexOf(raw: string | null | undefined): "girl" | "boy" | null {
  const s = (raw ?? "").toLowerCase();
  if (s === "girl" || s === "female" || s === "f") return "girl";
  if (s === "boy" || s === "male" || s === "m") return "boy";
  return null;
}

/** English pronouns for a subject from its recorded sex; they/them when unknown. */
export function pronouns(sex: string | null | undefined): Pronouns {
  const s = sexOf(sex);
  if (s === "girl") return { they: "she", them: "her", their: "her", is: "is", was: "was", s: "s" };
  if (s === "boy") return { they: "he", them: "him", their: "his", is: "is", was: "was", s: "s" };
  return { they: "they", them: "them", their: "their", is: "are", was: "were", s: "" };
}

export function childPronouns(me: Named | null | undefined): Pronouns {
  return pronouns(child(me)?.sex);
}

/** Capitalise the first letter: "she" → "She". */
export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
