/**
 * The plain things said most often, understood on the phone with no model call (Mido,
 * 9 November: the helper is becoming the main way to log, so the everyday phrases must be
 * free, instant and work offline). "120 ml bottle", "wet nappy", "she fell asleep 10 min
 * ago", "woke up at 6:40", "slept 1 to 2:15". Strict on purpose: every word must be one this
 * reader knows, otherwise it returns null and the helper (the model) takes the message, so
 * an unusual sentence is never half-understood. Pure: no "@/" imports, local times only (the
 * caller converts with lib/time), so the unit tests load it on its own.
 */
import { parseClock, resolveTyped } from "../typed-time.ts";

/** When it happened: minutes before now, or a local "YYYY-MM-DDTHH:MM". */
export type QuickWhen = { agoMin: number } | { local: string };

export type QuickLog =
  | { kind: "bottle"; amount_ml: number; milk: string | null; when: QuickWhen }
  | { kind: "diaper"; diaper: string | null; when: QuickWhen }
  | { kind: "sleep_start"; when: QuickWhen }
  | { kind: "wake"; when: QuickWhen }
  | { kind: "sleep"; from: string; to: string };

export interface QuickVocab {
  /** The child's first name, lower case, so "Lana had 120 ml" reads. */
  name?: string | null;
  /** The nappy type's kind options ("Wet", "Dirty", "Both"). */
  diaperKinds: string[];
  /** The feed type's milk options; only one named in the words ("formula") is used. */
  milks: string[];
}

const CLOCK = String.raw`(\d{1,2}(?:[:.]\d{2})?\s?(?:[ap]\.?m\.?)?|\d{3,4})`;
const AGO = [
  { re: /\bhalf an? hour ago\b/, min: () => 30 },
  { re: /\b(?:an|one|1) hour ago\b/, min: () => 60 },
  { re: /\b(\d{1,2})\s?(?:h|hr|hrs|hours?)\s?(?:and\s)?(\d{1,2})\s?(?:m|min|mins|minutes?)\s?ago\b/, min: (m: RegExpMatchArray) => Number(m[1]) * 60 + Number(m[2]) },
  { re: /\b(\d{1,2}(?:\.5)?)\s?(?:h|hr|hrs|hours?)\s?ago\b/, min: (m: RegExpMatchArray) => Math.round(Number(m[1]) * 60) },
  { re: /\b(\d{1,3})\s?(?:m|min|mins|minutes?)\s?ago\b/, min: (m: RegExpMatchArray) => Number(m[1]) },
];

const QUESTION = /^(is|was|are|were|did|does|do|has|have|had|when|how|what|why|who|where|which|should|can|could|will|would|shall)\b/i;
const COMMON = new Set(["log", "logged", "add", "she", "shes", "he", "hes", "the", "a", "her", "him", "just", "has", "had", "is", "was", "baby", "we", "i"]);
const BOTTLE = new Set(["bottle", "of", "fed", "feed", "drank", "drunk", "gave", "took", "finished", "ml", "milk"]);
const DIAPER = new Set(["nappy", "diaper", "changed", "change", "did", "wet", "dirty", "poo", "poop", "poopy", "pooey", "soiled", "both", "and"]);
const ASLEEP = new Set(["fell", "asleep", "went", "down", "sleeping", "for", "nap", "napping", "to", "sleep", "started", "now"]);
const AWAKE = new Set(["woke", "up", "awake", "woken", "got", "wakes", "now"]);
const SLEPT = new Set(["slept", "napped", "nap", "from", "to", "until", "till", "a"]);

/**
 * What a message means, or null when it is anything but one plain thing (the helper takes it).
 * `nowLocal` is the household's local "YYYY-MM-DDTHH:MM" now.
 */
export function readQuick(message: string, nowLocal: string, vocab: QuickVocab): QuickLog | null {
  // A question ("Is she asleep?", "Was she fed 120 ml?") is never a log.
  if (/\?/.test(message) || QUESTION.test(message.trim())) return null;
  let t = ` ${message.toLowerCase().replace(/[’']/g, "").replace(/[!?,;]+/g, " ").replace(/\.(?!\d)/g, " ").replace(/\s+/g, " ").trim()} `;
  if (t.length > 80) return null;
  if (vocab.name) t = t.replace(new RegExp(`\\b${vocab.name.toLowerCase().replace(/[^a-z]/g, "")}s?\\b`, "g"), " ");

  // A finished sleep: "slept 1 to 2:15", "napped from 13:00 till 13:45".
  const span = t.match(new RegExp(String.raw`\b(?:from\s)?${CLOCK}\s?(?:to|till|until|-|–)\s?${CLOCK}\b`));
  if (span) {
    const rest = words(t.replace(span[0], " "));
    if (!rest.some((w) => w === "slept" || w === "napped") || !rest.every((w) => SLEPT.has(w) || COMMON.has(w))) return null;
    const to = resolveBare(span[2], nowLocal);
    const from = to ? resolveBare(span[1], to) : null;
    if (!from || !to || from >= to || minutesBetween(from, to) > 14 * 60) return null;
    return { kind: "sleep", from, to };
  }

  // When: "10 min ago", "at 6:40", "now"; at most one.
  let when: QuickWhen = { agoMin: 0 };
  let found = 0;
  for (const a of AGO) {
    const m = t.match(a.re);
    if (m) {
      when = { agoMin: a.min(m) };
      t = t.replace(m[0], " ");
      found++;
      break;
    }
  }
  const at = t.match(new RegExp(String.raw`\bat\s${CLOCK}(?=\s)`));
  if (at) {
    const local = resolveBare(at[1], nowLocal);
    if (!local) return null;
    when = { local };
    t = t.replace(at[0], " ");
    found++;
  }
  if (found > 1) return null;
  if ("agoMin" in when && when.agoMin > 24 * 60) return null;
  t = t.replace(/\b(?:just\s)?(?:right\s)?now\b/g, " ");

  // A bottle: "120 ml", "fed her a bottle of 120ml formula".
  const ml = t.match(/\b(\d{2,3})\s?ml\b/);
  if (ml) {
    const amount = Number(ml[1]);
    if (amount < 10 || amount > 400) return null;
    const rest = words(t.replace(ml[0], " ml "));
    const milk = vocab.milks.find((o) => rest.includes(o.toLowerCase()) && !o.includes(" ")) ?? null;
    if (!rest.every((w) => BOTTLE.has(w) || COMMON.has(w) || (milk && w === milk.toLowerCase()))) return null;
    return { kind: "bottle", amount_ml: amount, milk, when };
  }

  const ws = words(t);
  if (!ws.length) return null;
  const all = (set: Set<string>) => ws.every((w) => set.has(w) || COMMON.has(w));

  // A nappy: "wet nappy", "dirty diaper", "changed her nappy" (the kind then asked).
  if (ws.some((w) => w === "nappy" || w === "diaper" || w === "poo" || w === "poop") && all(DIAPER)) {
    const wet = ws.includes("wet");
    const dirty = ws.some((w) => ["dirty", "poo", "poop", "poopy", "pooey", "soiled"].includes(w));
    const want = ws.includes("both") || (wet && dirty) ? "both" : wet ? "wet" : dirty ? "dirty" : null;
    const diaper = want ? vocab.diaperKinds.find((k) => k.toLowerCase() === want) ?? null : null;
    if (want && !diaper) return null;
    return { kind: "diaper", diaper, when };
  }
  // Asleep: "fell asleep", "went down for a nap", "she is sleeping".
  if (ws.some((w) => w === "asleep" || w === "sleeping" || w === "napping" || w === "down") && all(ASLEEP)) return { kind: "sleep_start", when };
  // Awake: "woke up", "she is awake".
  if (ws.some((w) => w === "woke" || w === "awake" || w === "woken") && all(AWAKE)) return { kind: "wake", when };
  return null;
}

/** The answer to the one question this reader asks ("Wet, dirty or both?"), or null. */
export function readDiaperAnswer(message: string, kinds: string[]): string | null {
  const t = message.trim().toLowerCase().replace(/[.!]/g, "");
  const want = /^(both|wet and dirty|dirty and wet)$/.test(t) ? "both" : /^(wet|just wet)$/.test(t) ? "wet" : /^(dirty|poo|poop|poopy|just dirty)$/.test(t) ? "dirty" : null;
  return want ? kinds.find((k) => k.toLowerCase() === want) ?? null : null;
}

function words(t: string): string[] {
  return t.split(" ").filter(Boolean);
}
function minutesBetween(a: string, b: string): number {
  return (Date.parse(`${b}:00Z`) - Date.parse(`${a}:00Z`)) / 60_000;
}
/**
 * The most recent time a clock said in words can mean, up to `ref`: "6:40" said at 15:00 is
 * 06:40 today, "1" is 13:00, "11" at 09:00 is 23:00 last night. With am/pm, a 24 h hour (13
 * and up) or four digits ("0130", "1330") it means exactly that clock.
 */
export function resolveBare(clock: string, ref: string): string | null {
  const text = clock.replace(/\s/g, "");
  const c = parseClock(text);
  if (!c) return null;
  const exact = resolveTyped(text, ref);
  if (/[ap]/.test(text) || /^\d{4}$/.test(text) || c.h === 0 || c.h > 12) return exact;
  const other = resolveTyped(`${(c.h + 12) % 24}:${String(c.m).padStart(2, "0")}`, ref);
  return [exact, other].filter((x): x is string => !!x).sort().pop() ?? null;
}
