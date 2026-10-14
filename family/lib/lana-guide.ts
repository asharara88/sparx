import type { EntryRow } from "@/lib/types";
import { normsForAge } from "@/lib/norms";
import { nextFeedAt } from "@/lib/forecast";
import { ageOutlook, growthSpurt } from "@/lib/lana-insights";

/**
 * Lana's guide: the last 24 hours against what is usual for her age, as short
 * tips. Totals are only judged once the log covers most of the day, so a quiet
 * log does not look like a sick baby. Ranges come from lib/norms (NHS, AAP,
 * National Sleep Foundation); wake windows from common paediatric guidance.
 */
export type Tip = { level: "red" | "yellow" | "info"; title: string; body: string; topic: "nappies" | "poo" | "feeds" | "sleep" | "fever" };
export type GuideOptions = { timezone?: string; feedGapMin?: number };

const H = 3_600_000;
const mins = (ms: number) => Math.round(ms / 60_000);
export const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`);

function wakeWindow(days: number): [number, number] {
  const months = days / 30.4375;
  if (months < 3) return [60, 90];
  if (months < 6) return [90, 150];
  if (months < 12) return [120, 210];
  return [180, 300];
}

export function tipsFor(entries: EntryRow[], birthDate: string | null, now = Date.now(), opts: GuideOptions = {}): Tip[] {
  const days = birthDate ? Math.floor((now - Date.parse(birthDate)) / 86_400_000) : 120;
  const n = normsForAge(days);
  const [wakeLo, wakeHi] = wakeWindow(days);
  const t = (e: EntryRow) => Date.parse(e.occurred_at);
  const sorted = [...entries].sort((a, b) => t(b) - t(a));
  const day = sorted.filter((e) => now - t(e) <= 24 * H);
  if (!day.length) return [{ level: "yellow", title: "Nothing logged in 24 hours", body: "Was anything missed? Log feeds, diapers and sleep so the guide can help.", topic: "feeds" }];
  const tips: Tip[] = [];
  const covered = (now - Math.min(...day.map(t))) / H >= 18;

  // Diapers
  const nappies = day.filter((e) => e.type_id === "lana.diaper");
  const wet = nappies.filter((e) => e.payload.kind !== "Dirty").length;
  const lastNappy = sorted.find((e) => e.type_id === "lana.diaper");
  if (covered && wet <= 3) tips.push({ level: "red", title: `Only ${wet} wet diaper${wet === 1 ? "" : "s"} in 24 h`, body: `Were any changes missed? Babies her age usually have ${n.wet.low} or more wet diapers a day. If that is right, offer more milk. Call the doctor if she seems drowsy, has a dry mouth or dark wee.`, topic: "nappies" });
  else if (covered && wet < n.wet.low) tips.push({ level: "yellow", title: `${wet} wet diapers in 24 h`, body: `A bit under the usual ${n.wet.low} or more. Check whether any were missed, and offer feeds a little more often today.`, topic: "nappies" });
  if (lastNappy && now - t(lastNappy) > 5 * H) tips.push({ level: "yellow", title: `No diaper for ${hm(mins(now - t(lastNappy)))}`, body: "Time to check her diaper. Was a change missed?", topic: "nappies" });
  const lastDirty = sorted.find((e) => e.type_id === "lana.diaper" && (e.payload.kind === "Dirty" || e.payload.kind === "Both"));
  if (lastDirty && now - t(lastDirty) > 4 * 24 * H) tips.push({ level: "yellow", title: "No dirty diaper for 4 or more days", body: "Can be normal for a breastfed baby over 6 weeks who feeds well and is comfortable. Call the doctor if her tummy is hard or swollen, she is in pain or vomiting.", topic: "poo" });

  // Feeds
  const feeds = day.filter((e) => e.type_id === "lana.feed");
  const lastFeed = sorted.find((e) => e.type_id === "lana.feed");
  if (covered && feeds.length < n.feeds.low) tips.push({ level: feeds.length <= n.feeds.low - 2 ? "red" : "yellow", title: `${feeds.length} feeds in 24 h`, body: `Usual at her age: ${n.feeds.low} to ${n.feeds.high} feeds. Were any feeds missed in the log?`, topic: "feeds" });
  if (lastFeed && now - t(lastFeed) > 4 * H) tips.push({ level: now - t(lastFeed) > 5 * H ? "red" : "yellow", title: `Last feed ${hm(mins(now - t(lastFeed)))} ago`, body: "Longer than usual between feeds. Offer a feed, or log one if it was missed.", topic: "feeds" });
  else {
    // Likely hungry soon: from how much she took last time, not a fixed clock.
    const nf = nextFeedAt(sorted, { gapMin: opts.feedGapMin ?? 180 });
    if (nf) {
      const m = mins(nf.at - now);
      if (m <= 0 && m > -60) tips.push({ level: "info", title: "Likely hungry now", body: "Look for rooting, hands to the mouth or fussing. Offer a feed.", topic: "feeds" });
      else if (m > 0 && m <= 30) tips.push({ level: "info", title: `Likely hungry in about ${m} min`, body: nf.fullness < 0.75 ? "The last feed was a small one, so this comes sooner." : "From her usual gap between feeds.", topic: "feeds" });
    }
  }
  const dayOf = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: opts.timezone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  const spurt = growthSpurt(entries, dayOf, now);
  if (spurt) {
    const phase = birthDate ? ageOutlook(days).now.find((w) => /spurt|sleep change|teething/i.test(w)) : null;
    tips.push({ level: "info", title: "Possible growth spurt", body: `She is feeding about ${spurt.recentPerDay} times a day, up from ${spurt.beforePerDay}.${phase ? ` At her age this fits: ${phase.toLowerCase()}.` : ""} This is common and usually lasts 2 to 3 days: feed on demand. Call the doctor if she has fewer than 6 wet diapers a day or seems unwell.`, topic: "feeds" });
  }

  // Sleep
  const sleeps = sorted.filter((e) => e.type_id === "lana.sleep");
  const asleep = sleeps.find((e) => !e.ended_at);
  const last = sleeps.find((e) => e.ended_at);
  if (!asleep && last && last.ended_at) {
    const napMin = mins(Date.parse(last.ended_at) - t(last));
    const awakeMin = mins(now - Date.parse(last.ended_at));
    if (napMin < 30 && awakeMin < 60) tips.push({ level: "yellow", title: `Short nap, only ${napMin} min`, body: `Lana needs more sleep. Try settling her again (dark room, white noise, rocking). She will be tired again within about ${hm(Math.max(15, wakeLo - awakeMin))}.`, topic: "sleep" });
    if (awakeMin > wakeHi) tips.push({ level: awakeMin > wakeHi + 45 ? "red" : "yellow", title: `Awake for ${hm(awakeMin)}`, body: `Babies her age usually manage ${hm(wakeLo)} to ${hm(wakeHi)} awake. Watch for yawning, rubbing eyes and fussing, and try a nap now.`, topic: "sleep" });
    else if (awakeMin > wakeLo && napMin >= 30) tips.push({ level: "info", title: "Nap time is coming", body: `She has been awake ${hm(awakeMin)}. The next nap is usually within ${hm(wakeHi - awakeMin)}.`, topic: "sleep" });
  }
  if (covered) {
    const sleptMin = sleeps.reduce((s, e) => {
      const a = Math.max(t(e), now - 24 * H);
      const b = e.ended_at ? Date.parse(e.ended_at) : now;
      return b > a ? s + (b - a) / 60_000 : s;
    }, 0);
    const h = sleptMin / 60;
    const lo = n.sleepMin.low / 60;
    if (h < lo - 1) tips.push({ level: h < lo - 3 ? "red" : "yellow", title: `${h.toFixed(1)} h sleep in 24 h`, body: `Usual at her age: ${lo} to ${n.sleepMin.high / 60} h including naps. Was any sleep not logged? If not, aim for earlier naps and bedtime.`, topic: "sleep" });
  }
  const order = { red: 0, yellow: 1, info: 2 };
  return tips.sort((a, b) => order[a.level] - order[b.level]);
}

export type Topic = { id: Tip["topic"]; title: string; normal: string; call: string[]; emergency: string[]; src: string[] };
/** When to call the doctor: warning signs from NHS, AAP and NICE guidance. */
export const TOPICS: Topic[] = [
  {
    id: "nappies", title: "Wet diapers and dehydration",
    normal: "After the first week, 6 or more heavy wet diapers a day with pale, clear wee.",
    call: ["Fewer than 6 wet diapers in 24 hours, or very light ones", "Dark yellow or strong-smelling wee", "Dry mouth, lips or no tears when crying", "Feeding less than usual or refusing feeds"],
    emergency: ["No wet diaper for 12 hours or more", "Sunken soft spot on top of the head or sunken eyes", "Very sleepy, floppy or hard to wake", "Cold hands and feet with pale or blotchy skin"],
    src: ["NHS: Dehydration in children", "AAP (HealthyChildren.org): Signs of dehydration in infants"],
  },
  {
    id: "poo", title: "Poo",
    normal: "Breastfed babies over 6 weeks may poo several times a day or only once every few days. Soft yellow, green or brown is normal.",
    call: ["Hard, pellet-like poo or straining with pain", "No poo for 4 or more days and she seems uncomfortable", "Frequent watery poo, especially with fewer wet diapers"],
    emergency: ["Red blood, black poo (after the first days), or white or pale grey poo", "Swollen, hard tummy with vomiting", "Green (bile) vomit"],
    src: ["NHS: Constipation and diarrhoea in babies", "AAP: Infant constipation; stool colour warning signs"],
  },
  {
    id: "feeds", title: "Feeding",
    normal: "3 to 6 months: usually 6 to 8 feeds in 24 hours. Steady weight gain and enough wet diapers mean she is getting enough.",
    call: ["Feeding much less than usual for a day", "Not gaining weight, or dropping across growth chart lines", "Repeated forceful vomiting after feeds", "Coughing or choking during most feeds"],
    emergency: ["Refuses all feeds for several hours and seems unwell", "Breathing fast, grunting, or skin pulling in between the ribs", "Blue or grey lips"],
    src: ["NHS: Breastfeeding and bottle feeding guidance", "AAP: How much and how often to feed"],
  },
  {
    id: "sleep", title: "Sleep and being drowsy",
    normal: "4 to 12 months: 12 to 16 hours in 24 hours including naps. Short naps under 30 minutes are common and not a medical problem on their own.",
    call: ["Much sleepier than usual or hard to keep awake for feeds", "Crying a lot more than usual, or a cry that sounds different", "Snoring with pauses in breathing"],
    emergency: ["Cannot be woken, or floppy", "Pauses in breathing of 20 seconds or more, or turning blue", "A fit (seizure)"],
    src: ["AASM and AAP sleep duration consensus", "NHS: Safe sleep and serious illness signs"],
  },
  {
    id: "fever", title: "Fever and general illness",
    normal: "A normal temperature is about 36.5 to 37.5 °C.",
    call: ["3 to 6 months: temperature of 39 °C or higher", "Any fever lasting more than 2 days, or a rash", "She seems unwell and you are worried. Trust your instinct."],
    emergency: ["Under 3 months: any temperature of 38 °C or higher", "A rash that does not fade when you press a glass on it", "Stiff neck, bulging soft spot, or high-pitched cry"],
    src: ["NHS: Fever in children; NICE fever guideline NG143", "AAP: Fever and your baby"],
  },
];
