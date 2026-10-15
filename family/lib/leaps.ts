/**
 * The weeks calendar: what each stretch of the first three years usually
 * brings, week by week, in plain words. Built from the well-documented ages
 * (growth spurts, the 4-month sleep change, teething, solids, nap changes,
 * separation anxiety, walking, words, the 18-month and 2-year changes), not
 * from "wonder weeks", whose timing is weakly supported. "Tough" marks the
 * stretches where families most often report harder days. General guidance,
 * never a diagnosis; sources are named on screen.
 */

export interface LeapBand {
  fromWeek: number;
  toWeek: number;
  title: string;
  expect: string;
  tough: boolean;
  tip: string;
  source: string;
}

export const BANDS: LeapBand[] = [
  { fromWeek: 0, toWeek: 1, title: "The first week", expect: "Sleeping 16 to 18 hours in short bursts, feeding 8 to 12 times a day, losing a little weight then gaining it back by about day 10. Days and nights are not yet different to her.", tough: true, tip: "Feed on cue, sleep when she sleeps, and count wet nappies: 6 or more a day from day 5 is the reassurance.", source: "NHS; WHO" },
  { fromWeek: 2, toWeek: 3, title: "Growth spurt, 2 to 3 weeks", expect: "A couple of days of feeding almost non-stop, often in the evening, with a fussier baby. It passes in 2 to 3 days and supply follows.", tough: true, tip: "Feed on demand, keep the nappy count, and ignore the clock for a few days.", source: "NHS; La Leche League" },
  { fromWeek: 4, toWeek: 5, title: "Waking up to the world", expect: "Longer alert stretches, following faces and voices, the first real crying peaks start. Awake windows of 45 to 60 minutes.", tough: false, tip: "Put her down at the first yawn or stare into space; overtired comes fast at this age.", source: "AAP HealthyChildren; NHS" },
  { fromWeek: 6, toWeek: 7, title: "Six weeks: the peak of crying, and the first smiles", expect: "Crying peaks around now (up to 2 to 3 hours a day is within normal), with the evening witching hour. A growth spurt lands too. The first social smiles arrive.", tough: true, tip: "Swaddle, shush, sway, suck, side-hold. If you cannot cope, put her down safely and step out for a few minutes.", source: "AAP (Period of PURPLE Crying); NHS" },
  { fromWeek: 8, toWeek: 9, title: "Two months: first vaccines, longer stretches", expect: "The 8-week vaccines (a sore, sleepy day after is usual). Nights may give one longer stretch of 4 to 5 hours. Cooing starts.", tough: false, tip: "A short, same-every-night wind-down can start now: wash, nappy, pyjamas, feed, song, bed.", source: "NHS vaccination schedule; AAP" },
  { fromWeek: 10, toWeek: 12, title: "Settling into a rhythm", expect: "Crying eases, smiles and giggles grow, awake windows reach 60 to 90 minutes. A 3-month growth spurt is coming.", tough: false, tip: "Daylight and play by day, dim and boring at night, helps set her clock.", source: "AAP HealthyChildren; NHS" },
  { fromWeek: 13, toWeek: 15, title: "Three months: the growth spurt and the hands", expect: "Feeding more for a few days, then calmer. Hands meet in the middle, she bats at toys, head control gets steady. Naps may shorten to one sleep cycle.", tough: true, tip: "Short naps of 30 to 45 minutes are normal now; try settling her again at the first stir.", source: "CDC milestones; NHS" },
  { fromWeek: 16, toWeek: 20, title: "The 4-month sleep change", expect: "Sleep cycles become adult-like: more night waking and short naps for 2 to 6 weeks. Rolling may start, so swaddling ends at the first sign. The 4-month vaccines.", tough: true, tip: "Keep the routine exactly the same, practise drowsy-but-awake once a day, and do not add a new sleep prop you do not want long term.", source: "AAP HealthyChildren; NHS; Lullaby Trust" },
  { fromWeek: 21, toWeek: 25, title: "Five months: rolling and reaching", expect: "Rolling both ways, reaching and grabbing, laughing out loud, babbling begins. Drooling and chewing can start, usually before any tooth. Awake windows of about 2 hours.", tough: false, tip: "Tummy time with toys in a circle; let her pivot. Watch the signs of readiness for solids rather than the calendar.", source: "CDC milestones; AAP" },
  { fromWeek: 26, toWeek: 30, title: "Six months: solids, sitting, a growth spurt", expect: "Solids begin around now once she sits with support with a steady head and reaches for food. A growth spurt and often the first tooth. Sitting with support, then alone.", tough: true, tip: "One meal a day of soft, iron-rich food; milk stays the main food. Allergens early and often unless the doctor says otherwise.", source: "NHS weaning; WHO; AAP" },
  { fromWeek: 31, toWeek: 36, title: "Seven to eight months: on the move, and the first strangers", expect: "Sitting alone, pivoting, maybe crawling. Separation anxiety begins: she may cry when you leave the room. The 3-to-2 nap change starts for some.", tough: true, tip: "Peekaboo and short goodbyes teach her that you come back. Keep bedtime calm and the same with every carer.", source: "CDC milestones; NHS" },
  { fromWeek: 37, toWeek: 42, title: "Nine months: crawling, standing, a growth spurt", expect: "Crawling or shuffling, pulling to stand, pincer grip, waving and clapping. A 9-month growth spurt. Night waking often returns for a few weeks with the new skills.", tough: true, tip: "Let her practise the new skill by day so she does not rehearse it in the cot at 3 am.", source: "AAP HealthyChildren; CDC milestones" },
  { fromWeek: 43, toWeek: 48, title: "Ten to eleven months: cruising and pointing", expect: "Cruising along furniture, pointing to show you things, understanding simple words, feeding herself finger foods. Two naps a day.", tough: false, tip: "Follow her point and name it: shared attention is where talking starts.", source: "CDC milestones; NHS" },
  { fromWeek: 49, toWeek: 56, title: "One year: first steps and words", expect: "First words around now, first steps anywhere from 9 to 18 months. The 12-month vaccines. Sleep may wobble again with walking.", tough: true, tip: "Five words you use all day, said clearly in context. Walking comes when it comes.", source: "NHS; CDC milestones" },
  { fromWeek: 57, toWeek: 65, title: "Thirteen to fifteen months: the 2-to-1 nap change begins", expect: "One nap may start replacing two, with cranky afternoons while it settles. Walking steadies, scribbling, stacking two blocks, pretend sips from a cup.", tough: true, tip: "Move the single nap to after an early lunch and bring bedtime earlier on one-nap days.", source: "AAP HealthyChildren; NHS" },
  { fromWeek: 66, toWeek: 78, title: "Sixteen to eighteen months: words, will and tantrums", expect: "Ten or more words, following simple instructions, a strong sense of what she wants. Tantrums begin because feelings outrun words. The 18-month check.", tough: true, tip: "Name the feeling, keep the limit, offer two choices. Consistency across carers matters most.", source: "CDC milestones; NHS" },
  { fromWeek: 79, toWeek: 91, title: "Nineteen to twenty-one months: two-word phrases", expect: "Two words together, running, kicking a ball, helping with little jobs, copying you. Picky eating is common and usually passes.", tough: false, tip: "Offer, do not force; a food can take ten tries. Eat together when you can.", source: "NHS; AAP HealthyChildren" },
  { fromWeek: 92, toWeek: 104, title: "Two years", expect: "Fifty or more words, short sentences, jumping, pretend play with others. Night fears and bedtime stalling can start. The 2-year check.", tough: true, tip: "A short, predictable bedtime with a night light if she wants one; a firm, kind last goodnight.", source: "CDC milestones; NHS" },
  { fromWeek: 105, toWeek: 130, title: "Two to two and a half", expect: "Potty readiness signs for some, climbing everything, longer sentences, the first real friendships. The nap may start to go.", tough: false, tip: "Potty training waits for her signs, not a date. When the nap goes, keep quiet time.", source: "NHS; AAP HealthyChildren" },
  { fromWeek: 131, toWeek: 156, title: "Two and a half to three", expect: "Conversations, questions all day, pedalling a tricycle, dressing with help, playing make-believe. Many give up the nap by three.", tough: false, tip: "Answer the questions; read every day; let her help with real jobs.", source: "CDC milestones; NHS" },
];

export interface LeapWeek {
  week: number;
  band: LeapBand;
  /** How many weeks into this stretch she is. */
  weekInBand: number;
  next: LeapBand | null;
  weeksToNext: number | null;
}

/** Which week she is in and what that stretch brings. Null past the calendar. */
export function leapWeek(ageDays: number): LeapWeek | null {
  const week = Math.floor(Math.max(0, ageDays) / 7);
  const i = BANDS.findIndex((b) => week >= b.fromWeek && week <= b.toWeek);
  if (i < 0) return null;
  const band = BANDS[i];
  const next = BANDS[i + 1] ?? null;
  return { week, band, weekInBand: week - band.fromWeek + 1, next, weeksToNext: next ? next.fromWeek - week : null };
}
