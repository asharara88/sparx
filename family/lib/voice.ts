/**
 * The voice the app speaks with: the warmest female voice the phone has for the
 * member's language, a touch slower than the default. Phones name their voices, so
 * the choice goes by name (Samantha, Milena, Laila…), then by quality words
 * ("Enhanced", "Premium", "Natural"); a known male voice is the last resort. No
 * service, no cost: what the phone has is what it says.
 */

/** Female voices on iPhone, Mac, Android (Google) and Windows, lower case. */
const FEMALE = [
  "samantha", "karen", "moira", "tessa", "serena", "kate", "victoria", "allison", "ava", "susan", "zoe", "fiona", "martha", "stephanie",
  "zira", "hazel", "jenny", "aria", "libby", "sonia", "natasha", "clara", "emma", "michelle", "nancy",
  "milena", "katya", "irina", "svetlana", "dariya", "alena", "anna",
  "laila", "layla", "salma", "hoda", "zariyah", "amina", "mariam", "fatima", "sana", "shakir-female",
  "female", "woman", "frau", "femme",
];
/** Male voices that would otherwise win on a quality word. */
const MALE = ["daniel", "alex", "fred", "tom", "aaron", "arthur", "oliver", "gordon", "rishi", "david", "mark", "george", "guy", "ryan", "thomas", "maged", "majed", "hamed", "naayf", "shakir", "tarik", "yuri", "pavel", "dmitry", "male"];
const QUALITY = ["premium", "enhanced", "natural", "neural", "siri"];

type VoiceLike = { name: string; lang: string; localService?: boolean; default?: boolean };

const has = (name: string, words: string[]) => words.some((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(name));

/** The best voice for a BCP 47 language ("ar-EG", "ru-RU", "en-GB"), or null when the phone has none in it. */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], bcp47: string): V | null {
  const want = bcp47.toLowerCase();
  const base = want.split("-")[0];
  const inLang = voices.filter((v) => v.lang.toLowerCase().replace("_", "-").split("-")[0] === base);
  if (inLang.length === 0) return null;
  const score = (v: V) => {
    const name = v.name.toLowerCase();
    let s = 0;
    if (has(name, FEMALE)) s += 10;
    if (has(name, MALE) && !has(name, ["female"])) s -= 10;
    if (has(name, QUALITY)) s += 3;
    if (v.lang.toLowerCase().replace("_", "-") === want) s += 2;
    if (v.localService) s += 1;
    return s;
  };
  return [...inLang].sort((a, b) => score(b) - score(a))[0];
}

/** Warm and unhurried: a little slower and a little higher than the phone's default. */
export const WARM = { rate: 0.94, pitch: 1.06 } as const;

/** An utterance in the member's language, in the chosen voice. Browser only. */
export function warmUtterance(text: string, bcp47: string): SpeechSynthesisUtterance {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = bcp47;
  const v = pickVoice(speechSynthesis.getVoices(), bcp47);
  if (v) u.voice = v;
  u.rate = WARM.rate;
  u.pitch = WARM.pitch;
  return u;
}

/** Chrome fills the voice list a moment after load; ask early so the first tap has it. */
export function primeVoices(): void {
  if (typeof speechSynthesis === "undefined") return;
  speechSynthesis.getVoices();
  speechSynthesis.addEventListener?.("voiceschanged", () => speechSynthesis.getVoices(), { once: true });
}

/**
 * Text cut into pieces of at most `max` characters, at sentence ends where it can, else at
 * a space, so a long answer is read whole (the server takes 1200 characters a call).
 */
export function speechChunks(text: string, max = 1000): string[] {
  const out: string[] = [];
  let rest = text.replace(/\s+/g, " ").trim();
  while (rest.length > max) {
    const window = rest.slice(0, max + 1);
    const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "), window.lastIndexOf("؟ "), window.lastIndexOf("。"));
    const cut = sentence > max / 3 ? sentence + 1 : window.lastIndexOf(" ") > 0 ? window.lastIndexOf(" ") : max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}
