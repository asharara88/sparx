#!/usr/bin/env node
/**
 * Turns Dana's handwritten-style notes (family/data/lana-notes.txt, not in
 * git) into care_entries rows for the "home" project.
 *
 *   node scripts/backfill/parse-notes.mjs            # writes data/lana-entries.json + data/lana-review.csv
 *
 * The notes are one line per thing that happened, in order, under a weekday
 * header. Times are local (Asia/Dubai). Headers are sometimes wrong (the
 * weekday is more reliable than the date), some days have no header, am/pm
 * is often missing and sometimes a typo. Everything the parser guesses is
 * flagged in the entry note so it can be checked in the app.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "..", "data");
const text = readFileSync(join(dataDir, "lana-notes.txt"), "utf8");

const YEAR = 2026;
const TZ = "+04:00";
const SUBJECT = "00000000-0000-4000-8000-00000000a001";
const M = {
  mido: "00000000-0000-4000-8000-000000000001",
  dana: "00000000-0000-4000-8000-000000000002",
  wafa: "00000000-0000-4000-8000-000000000003",
  luda: "00000000-0000-4000-8000-000000000004",
  lilly: "00000000-0000-4000-8000-000000000005",
};
const MONTHS = { june: 6, july: 7, august: 8, september: 9, october: 10 };
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DEFAULT_FEED_MIN = 12;
const DEFAULT_WAKE_MIN = 15;

// ---------------------------------------------------------------- helpers
const uuid5 = (name) => {
  const h = createHash("sha1").update("lana-backfill:" + name).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
};
const dayMs = 86_400_000;
const utcDate = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const addDays = (date, n) => new Date(date.getTime() + n * dayMs);
const iso = (date, minutes) => {
  // `date` is a UTC-midnight stand-in for a local day; minutes may be <0 or >1440
  const t = new Date(date.getTime() + minutes * 60_000);
  const p = (n) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}T${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:00${TZ}`;
};
const isNightMin = (m) => {
  const h = ((m % 1440) + 1440) % 1440;
  return h >= 19 * 60 || h < 7 * 60;
};

// ---------------------------------------------------------------- time tokens
// Strip things that look like times but are not.
function stripNonTimes(s) {
  return s
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:-|to|or)?\s*\d*\s*ml\b/gi, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|cm)\b/gi, " ")
    .replace(/\b\d+\s*(?:-|to)?\s*\d*\s*(?:mins?|minutes?|hours?|hrs?)\b/gi, " ")
    .replace(/\bx\s*\d+\b/gi, " ")
    .replace(/\b\d+\s*(?:months?|times|days)\b/gi, " ")
    .replace(/\b[0o]\.\d+(?!\s*(?:am|pm|[0-9]))/gi, " ")
    .replace(/(?<![\d:])\b\d{1,2}\s*-\s*\d{1,2}\b(?![:\d]|\s*[ap]\.?m)/gi, " ")
    .replace(/\b\d+(?:st|nd|rd|th)\b/gi, " ")
    .replace(/\b\d+\s*(?:min|hour)\b/gi, " ")
    .replace(/\(\s*from\s+\d+\s*\)/gi, " ");
}
const TIME_RE = /(?<![a-z\d])(\d{1,2})(?:\s*[:;.!]\s*(\d{1,3}))?(?:\s*(am|pm|a\.m\.?|p\.m\.?|apm|an|sm|om|a|p)(?![a-z]))?(?:\s*(?:ish|iish|kjsh|osh|\?)+)?(?![\d:])/gi;

/** All time tokens in a segment, in order: {min, explicit} with min in 0..1439 for explicit, else am-reading. */
function timeTokens(seg, { allowBare = false } = {}) {
  const s = stripNonTimes(seg).replace(/\bmidnight\b/gi, "12:00am").replace(/\bnoon\b/gi, "12:00pm").replace(/\b(\d{1,2}) something\b/gi, "$1:00");
  const out = [];
  for (const m of s.matchAll(TIME_RE)) {
    let h = Number(m[1]);
    let mm = m[2] == null ? 0 : m[2].length === 3 ? Number(m[2].slice(0, 2)) : m[2].length === 1 ? Number(m[2]) * 10 : Number(m[2]);
    if (h > 12 && h <= 24 && m[2] == null) continue; // "20 mins" leftovers etc.
    if (h > 24 || mm > 59) continue;
    const suf = (m[3] ?? "").toLowerCase().replace(/\./g, "");
    let mer = null;
    if (["am", "a", "an", "sm"].includes(suf)) mer = "am";
    else if (["pm", "p", "om"].includes(suf)) mer = "pm";
    else if (suf === "apm") mer = null;
    if (h === 24) h = 0;
    const base = (h % 12) * 60 + mm;
    const before = s.slice(Math.max(0, m.index - 12), m.index);
    const bare = m[2] == null && mer === null && !/ish|\?/i.test(m[0]) && !/(?:to|till|until|at|around|-|–|woke up|up)\s*$/i.test(before);
    out.push({ raw: m[0].trim(), explicit: mer !== null, min: mer === "pm" ? base + 720 : base, base, index: m.index, bare });
  }
  return allowBare ? out : out.filter((t) => !t.bare);
}

// ---------------------------------------------------------------- the walk
const entries = [];
const warnings = [];
let date = null; // UTC stand-in for the local day of the current header
let offset = 0; // minutes added after an un-headed rollover
let cursor = 0; // minutes of the last timed event on this day (can be <0, >1440)
let fresh = true; // nothing timed yet today
let openSleep = null; // entry awaiting an end
let prevEvening = false; // the day's notes opened with last night's feeds
let lineNo = 0;

function resolve(tok, { after = cursor - 30, spanMax = 240 } = {}) {
  // choose am/pm for an implicit token: the earliest reading >= `after`
  if (tok.explicit) return tok.min + offset;
  const cands = [tok.base, tok.base + 720, tok.base + 1440];
  for (const c of cands) if (c + offset >= after) return c + offset;
  return tok.base + offset;
}
function place(t, kind) {
  // t is minutes on the current header day (+offset). Decide rollover / previous evening.
  if (offset === 0 && t >= 19 * 60 && (fresh || (prevEvening && t - 1440 >= cursor - 30))) {
    fresh = false;
    prevEvening = true;
    cursor = t - 1440;
    return t - 1440;
  }
  prevEvening = false;
  if (!fresh && t < cursor - 360) {
    // went backwards by >6h: most likely a new day without a header
    offset += 1440;
    t += 1440;
    warnings.push(`line ${lineNo}: assumed next day (no header)${process.env.TRACE ? " " + new Error().stack.split("\n")[2].trim() : ""}`);
  }
  fresh = false;
  if (t > cursor) cursor = t;
  return t;
}
function flipIfTypo(t, tok) {
  // explicit am/pm that goes backwards >6h but is fine flipped: a typo
  if (!tok.explicit || fresh) return t;
  if (t < cursor - 360) {
    const alt = t + (tok.min >= 720 ? -720 : 720);
    if (alt >= cursor - 30 && alt <= cursor + 420) return alt;
  }
  return t;
}

function push(type, startMin, endMin, payload, note, extra = {}) {
  const e = {
    type_id: `lana.${type}`,
    occurred_at: iso(date, startMin),
    ended_at: endMin == null ? null : iso(date, Math.max(endMin, startMin)),
    payload,
    note: note || null,
    attributed_to: extra.attributed_to ?? null,
    line: lineNo,
    src: extra.src ?? "",
    _start: date.getTime() + startMin * 60_000,
    _end: endMin == null ? null : date.getTime() + Math.max(endMin, startMin) * 60_000,
  };
  entries.push(e);
  return e;
}
function closeOpenSleep(atMs, why) {
  if (!openSleep) return;
  if (atMs <= openSleep._start) return; // not yet: a later entry will close it
  {
    const cap = openSleep._start + 14 * 60 * 60_000;
    const end = Math.min(atMs, cap);
    openSleep._end = end;
    openSleep.ended_at = new Date(end).toISOString().replace(/\.\d{3}Z$/, TZ);
    openSleep.note = [openSleep.note, why].filter(Boolean).join("; ");
  }
  openSleep = null;
}
const feederOf = (s) => {
  const l = s.toLowerCase();
  if (/ahmed|\bdad\b|\bpapa\b/.test(l)) return M.mido;
  if (/mama luda|\bmom\b|\bluda\b/.test(l)) return M.luda;
  if (/fofa|wafa/.test(l)) return M.wafa;
  if (/\blil+y\b/.test(l)) return M.lilly;
  return null;
};
const sideOf = (s) => {
  const l = s.toLowerCase();
  const L = /\bleft\b|\blright\b/.test(l);
  const R = /\bright\b|\bfight\b/.test(l);
  if (/both boobs|both breasts/.test(l) || (L && R)) return "Both";
  if (L) return "Left";
  if (R) return "Right";
  return null;
};
const placeOf = (s) => {
  const l = s.toLowerCase();
  if (/crib|bassinet|cot/.test(l)) return "Cot";
  if (/baby nest|nest/.test(l)) return "Baby nest";
  if (/stroller|pram/.test(l)) return "Pram";
  if (/\bcar\b/.test(l)) return "Car";
  if (/carrier|sling/.test(l)) return "Carrier";
  if (/contact|chest|arms|tiger hold|on mama|on bed/.test(l)) return "Arms";
  if (/\bbed\b/.test(l)) return "Bed";
  return null;
};
const mlOf = (s) => {
  const m = s.match(/(\d+)\s*(?:-|to|or)\s*(\d+)\s*ml/i) ?? s.match(/(\d+)\s*ml/i);
  if (!m) return null;
  return m[2] ? Math.round((Number(m[1]) + Number(m[2])) / 2) : Number(m[1]);
};
const durOf = (s) => {
  const m = s.match(/(\d+(?:\.\d+)?)\s*(?:-\s*(\d+)\s*)?(mins?|minutes?|hours?|hrs?)\b/i) ?? (/couple of hours/i.test(s) ? [null, "2", null, "hours"] : null);
  if (!m) return null;
  let n = Number(m[1]);
  if (m[2]) n = (n + Number(m[2])) / 2;
  return /hour|hr/i.test(m[3]) ? Math.round(n * 60) : Math.round(n);
};
const splitSegments = (line) => line.split(/\s\/\s|\s&\s|\s\+\s(?=pumped|bath|walk|tummy|formula|diaper|bottle|\d|height)/i).map((s) => s.trim()).filter(Boolean);

/** A start token and optional end token out of a segment: "X to Y", "X - Y", "X till Y". */
function ranges(seg, toks) {
  const out = [];
  const s = stripNonTimes(seg);
  // pair tokens when the text between them is a range joiner
  let i = 0;
  while (i < toks.length) {
    const a = toks[i];
    const b = toks[i + 1];
    if (b) {
      const between = s.slice(a.index + a.raw.length, b.index).toLowerCase();
      if (/^(?:\s|to|-|–|till|until|and)+$/.test(between) && /to|-|–|till|until/.test(between)) {
        out.push({ start: a, end: b });
        i += 2;
        continue;
      }
    }
    out.push({ start: a, end: null });
    i += 1;
  }
  return out;
}
/** Resolve a (start,end) pair to minutes on the day, scoring am/pm readings. */
function resolveRange(r, spanMax) {
  const s = r.start;
  const e = r.end;
  const sc = s.explicit ? [[s.min, 0], [s.min + 1440, 0], [s.min + (s.min >= 720 ? -720 : 720), 400]] : [[s.base, 0], [s.base + 720, 0], [s.base + 1440, 0]];
  let best = null;
  for (const [sm, sp] of sc) {
    const sAbs = sm + offset;
    const back = cursor - sAbs;
    const sPen = sp + (fresh ? (sAbs >= 7 * 60 && sAbs < 19 * 60 ? 200 : 0) : back > 360 ? 1000 : back > 30 ? Math.round(back / 2) : sAbs - cursor > 240 ? sAbs - cursor - 240 : 0);
    if (!e) {
      const score = sPen + (sAbs >= cursor - 30 ? 0 : 1000);
      if (!best || score < best.score) best = { start: sAbs, end: null, score, flipped: sp > 0 };
      continue;
    }
    const ec = e.explicit ? [[e.min, 0], [e.min + 1440, 0], [e.min + (e.min >= 720 ? -720 : 720), 450]] : [[e.base, 0], [e.base + 720, 0], [e.base + 1440, 0], [e.base + 2160, 0]];
    for (const [em, ep] of ec) {
      const eAbs = em + offset;
      const diff = eAbs - sAbs;
      if (diff < 0 || diff > spanMax) continue;
      const score = sPen + ep + diff;
      if (!best || score < best.score) best = { start: sAbs, end: eAbs, score, flipped: sp > 0 || ep > 0 };
    }
  }
  if (!best || best.score > 900) {
    const sAbs = resolve(s);
    return { start: sAbs, end: null, flipped: false, broken: true };
  }
  return best;
}

// ---------------------------------------------------------------- line handlers
function handleHeader(m) {
  const wd = WEEKDAYS.indexOf(m[1].toLowerCase());
  const day = Number(m[2]);
  const mon = MONTHS[m[3].toLowerCase()];
  let d = utcDate(YEAR, mon, day);
  if (d.getUTCDay() !== wd || (date && d.getTime() <= date.getTime())) {
    // trust the weekday: the next such weekday after the current day
    const from = date ? addDays(date, 1) : d;
    let cand = from;
    for (let i = 0; i < 7; i++, cand = addDays(cand, 1)) if (cand.getUTCDay() === wd) break;
    warnings.push(`line ${lineNo}: header "${m[0].trim()}" read as ${cand.toISOString().slice(0, 10)}`);
    d = cand;
  }
  date = d;
  offset = 0;
  cursor = 0;
  fresh = true;
  prevEvening = false;
}

function handleFeedSegment(seg, lineSide, toks, noteBits, attributed) {
  const segSide = sideOf(seg) ?? lineSide;
  const rs = ranges(seg, toks);
  const dur = durOf(seg);
  for (const r of rs) {
    let { start, end, flipped, broken } = resolveRange(r, 240);
    const stok = r.start;
    const placed = place(flipIfTypo(start, stok), "feed");
    if (end != null) end += placed - start;
    start = placed;
    if (end != null) end = Math.max(end, start);
    const bits = [...noteBits];
    if (flipped) bits.push("am/pm corrected");
    if (broken) bits.push("end time unreadable");
    if (end == null) {
      end = start + (dur ?? DEFAULT_FEED_MIN);
      bits.push(dur ? "duration as written" : "end not noted");
    }
    if (end - start > 150) bits.push("long: check");
    closeOpenSleep(date.getTime() + start * 60_000, "ended at next entry");
    const base = { method: "Breast" };
    if (segSide === "Both") {
      const mid = Math.round((start + end) / 2);
      push("feed", start, mid, { ...base, side: "Left" }, [...bits, "both sides, split estimated"].join("; "), { src: seg, attributed_to: attributed });
      push("feed", mid, end, { ...base, side: "Right" }, [...bits, "both sides, split estimated"].join("; "), { src: seg, attributed_to: attributed });
    } else {
      if (segSide) base.side = segSide;
      else bits.push("side not noted");
      push("feed", start, end, base, bits.join("; "), { src: seg, attributed_to: attributed });
    }
    if (end > cursor) cursor = end;
  }
}

function handleDiaper(seg, timeMin, attributed) {
  const l = seg.toLowerCase();
  const wet = /wet|pee/.test(l);
  const dirty = /poo|loop|dirty|green/.test(l);
  const n = Number((l.match(/x\s*(\d)/) ?? [])[1] ?? 1);
  const parts = /x\s*1\s*wet\s*\+\s*1\s*poop/.test(l) ? ["Wet", "Dirty"] : Array.from({ length: Math.min(n, 4) }, () => (wet && dirty ? "Both" : dirty ? "Dirty" : wet ? "Wet" : null));
  const extra = seg.replace(/diae?per\s*changes?/i, "").replace(/\b(wet|poop+|pooo+p|pee|x\s*\d)\b/gi, "").replace(/[()\-–/+]/g, " ").replace(/\s+/g, " ").trim();
  parts.forEach((kind, i) => {
    const t = timeMin + i;
    const payload = kind ? { kind } : {};
    const note = [kind ? null : "kind not noted", extra || null].filter(Boolean).join("; ");
    push("diaper", t, null, payload, note, { src: seg, attributed_to: attributed });
    if (t > cursor) cursor = t;
  });
}

function handleBottle(seg, toks, attributed) {
  const multi = seg.match(/\((\d+)\/(\d+)\/(\d+)\s*ml\)/i);
  const times = seg.match(/bottles?\s*x\s*(\d)\s*times/i);
  const total = /\b\d+\s*ml bottles\b/i.test(seg);
  const milk = /formula|kendamill/i.test(seg) ? "Formula" : null;
  const bits = [];
  if (/pump/i.test(seg)) bits.push("pumped milk");
  if (/refused|wasn.?t happy|spit/i.test(seg)) bits.push(seg);
  let t = toks.length ? place(flipIfTypo(resolve(toks[0]), toks[0]), "feed") : cursor + 1;
  closeOpenSleep(date.getTime() + t * 60_000, "ended at next entry");
  if (multi) {
    [multi[1], multi[2], multi[3]].forEach((ml, i) => push("feed", t + i * 180, t + i * 180 + 15, { method: "Bottle", amount_ml: Number(ml) }, "time not noted (day summary)", { src: seg, attributed_to: attributed }));
    return;
  }
  if (times) {
    const rng = seg.match(/(\d+)\s*-\s*(\d+)/);
    const ml = mlOf(seg) ?? (rng ? Math.round((Number(rng[1]) + Number(rng[2])) / 2) : null);
    for (let i = 0; i < Number(times[1]); i++) push("feed", t + i * 180, t + i * 180 + 15, { method: "Bottle", ...(ml ? { amount_ml: ml } : {}) }, "time not noted (day summary)", { src: seg, attributed_to: attributed });
    return;
  }
  const ml = mlOf(seg);
  const payload = { method: "Bottle" };
  if (ml != null) payload.amount_ml = ml;
  if (milk) payload.milk = milk;
  if (total) bits.push("day total");
  if (!toks.length) bits.push("time not noted");
  if (ml == null) bits.push("amount not noted");
  push("feed", t, t + 15, payload, bits.join("; "), { src: seg, attributed_to: attributed });
  if (t + 15 > cursor) cursor = t + 15;
}

function handleSleepLine(line, segs) {
  // Collect, in order, the times and what they mean.
  const l = line.toLowerCase();
  const pl = placeOf(line);
  const payload = pl ? { place: pl } : {};
  const dur = durOf(line);
  let toks = timeTokens(line, { allowBare: true });
  const bits = [];
  if (/approx|ish|\?/.test(l)) bits.push("times approximate");

  const startsSleep = !/^(?:woke|wake)/.test(l) && /fell asleep|slept|nap|sleep at|asleep|back to (?:crib|sleep|bed)|settled|put (?:in|into|back)|transferred|crib at|in crib|bed at|catnap/.test(l);
  const woke = /woke|wake|awake|up at|until|till/.test(l);

  if (!toks.length) {
    // "Napped for 20 mins", "Contact nap 1 hour", "Almost 4 hour nap", "Napped 3 times"
    if (dur && !/times/.test(l)) {
      const t = cursor + 1;
      push("sleep", t, t + dur, payload, [...bits, "start time not noted"].join("; "), { src: line });
      cursor = t + dur;
    } else push("note", cursor + 1, null, {}, line, { src: line });
    return;
  }

  // Multiple spans: "Slept 4:30ish till 6:45am (crib) / 7am till 9am (bed)"
  const spanSegs = segs.filter((s) => timeTokens(s, { allowBare: true }).length >= 2 && /till|until|to|-|woke|–/.test(s));
  if (spanSegs.length >= 2 && !/woke/.test(l)) {
    for (const s of spanSegs) {
      const st = timeTokens(s, { allowBare: true });
      const r = resolveRange({ start: st[0], end: st[1] }, 14 * 60);
      const start = place(r.start, "sleep");
      const end = r.end + (start - r.start);
      closeOpenSleep(date.getTime() + start * 60_000, "ended at next entry");
      const p = placeOf(s) ? { place: placeOf(s) } : payload;
      push("sleep", start, end, p, [...bits, r.flipped ? "am/pm corrected" : null].filter(Boolean).join("; "), { src: s });
      if (end > cursor) cursor = end;
    }
    return;
  }

  // "Woke up 7am" / "woke up 12:50ish with gasses" with no sleep start on the line
  if (!startsSleep && woke) {
    for (const tok of toks) {
      let t = place(flipIfTypo(resolve(tok), tok), "wake");
      if (openSleep) closeOpenSleep(date.getTime() + t * 60_000, null);
      else if (isNightMin(t)) push("wake", t, t + DEFAULT_WAKE_MIN, {}, [...bits, "length not noted"].join("; "), { src: line });
    }
    return;
  }

  // "2:15 fell asleep - until 7": start is the first token; end the next one after until/till/to/woke/-
  const r = resolveRange({ start: toks[0], end: toks[1] ?? null }, 14 * 60);
  const start = place(flipIfTypo(r.start, toks[0]), "sleep");
  closeOpenSleep(date.getTime() + start * 60_000, "ended at next entry");
  if (r.flipped) bits.push("am/pm corrected");
  let end = r.end == null ? null : r.end + (start - r.start);
  if (end == null && dur) end = start + dur;
  const e = push("sleep", start, end, payload, bits.join("; "), { src: line });
  if (end == null) {
    openSleep = e;
  } else {
    if (end > cursor) cursor = end;
    // further times on the line are night wakings: "woke up 10pm / 12am / then 2ish"
    for (const tok of toks.slice(2)) {
      const t = resolve(tok, { after: cursor });
      if (t > cursor && isNightMin(t)) {
        push("wake", t, t + DEFAULT_WAKE_MIN, {}, "length not noted", { src: line });
        cursor = t;
      }
    }
  }
}

function handleGrowth(line) {
  const w = line.match(/weight:?\s*(\d+(?:[.,]\d+)?)\s*kg/i);
  const h = line.match(/height:?\s*(\d+(?:[.,]\d+)?)\s*cm/i);
  const head = line.match(/(?:•|\+|,)\s*(\d+(?:[.,]\d+)?)\s*cm\s*$/i);
  const payload = {};
  if (w) payload.weight_kg = Number(w[1].replace(",", "."));
  if (h) payload.length_cm = Number(h[1].replace(",", "."));
  if (head && (!h || head[1] !== h[1])) payload.head_cm = Number(head[1].replace(",", "."));
  const extra = line.replace(/weight:?\s*[\d.,]+\s*kg/i, "").replace(/height:?\s*[\d.,]+\s*cm/i, "").replace(/[\d.,]+\s*cm/i, "").replace(/[•+:]/g, " ").replace(/\s+/g, " ").trim();
  const t = fresh ? 10 * 60 : cursor + 1;
  push("growth", t, null, payload, extra || null, { src: line });
  if (/doctor|doc\b/i.test(line)) push("appointment", t, null, { clinic: "", reason: "Check-up" }, line, { src: line });
}

function handleMedication(line, toks) {
  const l = line.toLowerCase();
  const t = toks.length ? place(resolve(toks[0]), "med") : cursor + 1;
  let name, dose;
  if (/vaccin/.test(l)) {
    name = "2-month vaccines";
    dose = "as scheduled";
    push("appointment", t, null, { clinic: "", reason: "2-month vaccines" }, null, { src: line });
  } else if (/vitamin/.test(l)) {
    name = "Vitamin D";
    dose = (line.match(/(\d+)\s*drops?/i) ?? [])[0] ?? "drops";
  } else {
    name = "Adol";
    dose = (line.match(/[0o]\.5\s*ml/i) ?? ["0.5 ml"])[0].replace(/^o/i, "0");
  }
  push("medication", t, null, { name, dose }, /vaccin/.test(l) ? line : null, { src: line });
  if (t > cursor) cursor = t;
}

function handleRoutine(line, toks) {
  const l = line.toLowerCase();
  const acts = [];
  if (/\bwalk/.test(l)) acts.push("Walk");
  if (/\bbath/.test(l)) acts.push("Bath");
  if (/tummy/.test(l)) acts.push("Tummy time");
  if (/play|bouncer|f2f|talking|bicycle|roll practice/.test(l)) acts.push("Playtime");
  if (/reading|book/.test(l)) acts.push("Reading");
  if (/\bmall\b|beach|earthing|sunset/.test(l)) acts.push("Outing");
  const t = toks.length ? place(resolve(toks[0]), "routine") : cursor + 1;
  const who = feederOf(line);
  const extra = line.replace(/walk|bath|tummy time|play ?time|playing|book reading|reading|\//gi, " ").replace(/\s+/g, " ").trim();
  acts.forEach((activity, i) => push("routine", t + i, null, { activity }, extra && extra.length > 3 ? extra : null, { src: line, attributed_to: who }));
  if (t > cursor) cursor = t;
  return acts.length > 0;
}

function handleLine(raw) {
  const line = raw.replace(/\s+/g, " ").trim();
  if (process.env.TRACE && lineNo >= Number(process.env.TRACE.split("-")[0]) && lineNo <= Number(process.env.TRACE.split("-")[1] ?? process.env.TRACE))
    console.error(`#${lineNo} cursor=${cursor} offset=${offset} fresh=${fresh} :: ${line}`);
  if (line.length < 2) return;
  const l = line.toLowerCase();
  const header = line.match(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(\d{1,2})(?:st|nd|rd|th|at)?\s*(?:of\s+)?(june|july|august|september|october)/i);
  if (header) return handleHeader(header);
  if (!date) return; // the "Feeding" title line
  if (/^feeding$/i.test(line)) return;

  // growth / milestones / medication: whole-line kinds
  if (/^(weight|height)/i.test(line)) return handleGrowth(line);
  if (/vaccin|adol|vitamin d|^o\.5\s*ml|^0\.5\s*ml/i.test(line)) return handleMedication(line, timeTokens(line));
  if (/first time|1st time|1st bath|first bath|giggled|rolled from|held both|back to work|has a cold|cradle cap|came and cuddled|mall trip|first wake up/i.test(line) && !/first wake up/i.test(line)) {
    const t = cursor + 1;
    push("milestone", t, null, { what: line.replace(/[!:)]+$/g, "").trim() }, null, { src: line });
    if (/bath|mall/i.test(line)) handleRoutine(line, []);
    return;
  }

  const segs = splitSegments(line);
  const lineSide = sideOf(line);
  const allToks = timeTokens(line, { allowBare: true });
  const sleepy = /fell asleep|slept|nap|sleep at|^sleep$|asleep|woke|wake up|back to (?:crib|sleep|bed)|settled|put (?:in|into|back)|transferred|crib at|in crib|catnap|cluster feeding until/i.test(line) && !/diaper/i.test(line);
  const feedLike = lineSide !== null || /boob|breast|dream feed/i.test(line);

  // Sleep lines that also carry a feed are rare ("3:42 to 4am / 4:45 / 5/ cluster feeding until 5:15am") -> feed.
  if (sleepy && !feedLike && !/bottle|\d\s*ml\b/i.test(line)) return handleSleepLine(line, segs);

  // bare-times-only lines at night: feeds, side not noted ("3am / 5am / 6am", "11:50ish / 1ish / 3ish")
  const wordsOnly = line.replace(TIME_RE, "").replace(/[\/&,?]|ish|and|then|around|about|to/gi, "").trim();
  if (allToks.length && wordsOnly.length === 0 && !lineSide) {
    handleFeedSegment(line, null, allToks, ["night feed"], M.dana);
    return;
  }

  let lastDiaper = null;
  let handled = false;
  for (const seg of segs) {
    const sl = seg.toLowerCase();
    const segIsBareTime = seg.replace(TIME_RE, "").replace(/[\/&,?]|ish|and|then|around|about|to/gi, "").trim().length === 0;
    const toks = timeTokens(seg, { allowBare: segIsBareTime });
    const who = feederOf(seg);
    if (/diae?per|pooped (?:and|while)|peed/.test(sl) && !/poop diapers/.test(sl)) {
      const feedPart = seg.replace(/\(.*?diae?per.*?\)/i, "").trim();
      if (toks.length && (sideOf(seg) || lineSide) && /\(.*?diae?per.*?\)/i.test(seg)) {
        // "2:18 to 3:05pm - left boob (with diaper change in the middle)": a feed, and a diaper halfway
        const before = entries.length;
        handleFeedSegment(feedPart, lineSide, timeTokens(feedPart), [], M.dana);
        const f = entries[before];
        const mid = f ? Math.round(((f._start + (f._end ?? f._start)) / 2 - date.getTime()) / 60000) : cursor + 1;
        handleDiaper(seg.match(/\(.*?diae?per.*?\)/i)[0], mid, who);
        lastDiaper = entries[entries.length - 1];
        handled = true;
        continue;
      }
      const t = toks.length ? place(resolve(toks[0]), "diaper") : cursor + 1;
      handleDiaper(seg, t, who ?? (/\(fofa/.test(l) ? M.wafa : null));
      lastDiaper = entries[entries.length - 1];
      handled = true;
      continue;
    }
    if (/pump/.test(sl) && !/bottle/.test(sl)) {
      const ml = mlOf(seg);
      const side = sideOf(seg) ?? "Both";
      const t = toks.length ? place(resolve(toks[0]), "pump") : cursor + 1;
      push("pump", t, null, { ...(ml != null ? { amount_ml: ml } : {}), side }, ml == null ? "amount not noted" : /at work/.test(sl) ? "at work" : null, { src: seg });
      if (t > cursor) cursor = t;
      handled = true;
      continue;
    }
    if (/bottle|formula|kendamill|\d\s*ml\b|feedings/.test(sl) && !/boob/.test(sl)) {
      const next = segs[segs.indexOf(seg) + 1];
      const nextToks = next && next.replace(TIME_RE, "").trim() === "" ? timeTokens(next, { allowBare: true }) : [];
      handleBottle(seg, toks.length ? toks : nextToks, who ?? feederOf(line));
      if (nextToks.length) segs.splice(segs.indexOf(seg) + 1, 1);
      if (/walk/.test(sl)) handleRoutine(seg, []);
      handled = true;
      continue;
    }
    if (toks.length && (sideOf(seg) || lineSide || /boob|dream feed|cluster/.test(sl) || /leftovers/.test(sl))) {
      if (lastDiaper && !lineSide && !sideOf(seg) && toks.length === 1) {
        // "Diaper change poop / 4:30pm": the time belongs to the diaper
        const t = place(resolve(toks[0]), "diaper");
        lastDiaper.occurred_at = iso(date, t);
        lastDiaper._start = date.getTime() + t * 60_000;
        continue;
      }
      const bits = [];
      if (/spit|not sure|approx|can.?t remember|\?\?|passed out|fell asleep/.test(sl)) bits.push(seg.replace(/[-–]\s*(left|right)\s*(boob)?/i, "").trim());
      handleFeedSegment(seg, lineSide, toks, bits, M.dana);
      handled = true;
      continue;
    }
    if (/walk|bath|tummy|play|bouncer|reading|book|mall|beach|earthing|f2f|bicycle|roll practice|sunset/.test(sl) && !/bath time/.test(sl + "x")) {
      if (handleRoutine(seg, toks)) {
        handled = true;
        continue;
      }
    }
    if (toks.length && lastDiaper && !lineSide) {
      const t = place(resolve(toks[0]), "diaper");
      lastDiaper.occurred_at = iso(date, t);
      lastDiaper._start = date.getTime() + t * 60_000;
      continue;
    }
    if (/woke|wake|fell asleep|slept|napped|nap from|settled/.test(sl) && toks.length) {
      handleSleepLine(seg, [seg]);
      handled = true;
      continue;
    }
    // anything else on the line becomes a note
    if (seg.length > 2 && !/^(left|right)( boob)?\??$/i.test(seg)) {
      push("note", cursor + 1, null, {}, seg, { src: seg });
      handled = true;
    }
  }
  if (!handled) push("note", cursor + 1, null, {}, line, { src: line });
}

for (const raw of text.split(/\r?\n/)) {
  lineNo += 1;
  try {
    handleLine(raw);
  } catch (e) {
    warnings.push(`line ${lineNo}: ${e.message} :: ${raw}`);
  }
}
if (openSleep) warnings.push(`open sleep at end: line ${openSleep.line}`);

// ---------------------------------------------------------------- finish
entries.sort((a, b) => a._start - b._start || a.line - b.line);
const seen = new Map();
for (const e of entries) {
  const key = `${e.type_id}|${e.occurred_at}`;
  const n = (seen.get(key) ?? 0) + 1;
  seen.set(key, n);
  e.client_id = uuid5(`${key}|${n}`);
  if (e.ended_at && e._end != null) {
    const mins = Math.round((e._end - e._start) / 60_000);
    if (e.type_id === "lana.feed" && mins > 150) e.note = [e.note, "long feed: check"].filter(Boolean).join("; ");
    if (e.type_id === "lana.sleep" && mins > 13 * 60) e.note = [e.note, "long sleep: check"].filter(Boolean).join("; ");
  }
}
for (const e of entries) {
  if (!e.ended_at && (e.type_id === "lana.sleep" || e.type_id === "lana.wake" || (e.type_id === "lana.feed" && e.payload.method === "Breast"))) {
    e._end = e._start + 30 * 60_000;
    e.ended_at = iso(new Date(0), e._end / 60_000);
    e.note = [e.note, "end not noted"].filter(Boolean).join("; ");
    warnings.push(`line ${e.line}: ${e.type_id} left open, closed after 30 min`);
  }
}
const out = entries.map(({ _start, _end, ...e }) => e);
writeFileSync(join(dataDir, "lana-entries.json"), JSON.stringify(out, null, 1));

const csvq = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
const csv = ["date,start,end,type,summary,note,line,source"];
for (const e of out) {
  const sum = e.type_id === "lana.feed" ? (e.payload.method === "Breast" ? `breast ${e.payload.side ?? "?"}` : `bottle ${e.payload.amount_ml ?? "?"} ml${e.payload.milk ? " " + e.payload.milk : ""}`) : e.type_id === "lana.diaper" ? `diaper ${e.payload.kind ?? "?"}` : e.type_id === "lana.sleep" ? `sleep ${e.payload.place ?? ""}` : JSON.stringify(e.payload);
  csv.push([e.occurred_at.slice(0, 10), e.occurred_at.slice(11, 16), e.ended_at ? e.ended_at.slice(11, 16) + (e.ended_at.slice(0, 10) !== e.occurred_at.slice(0, 10) ? "+1" : "") : "", e.type_id.replace("lana.", ""), sum, e.note ?? "", e.line, e.src].map(csvq).join(","));
}
writeFileSync(join(dataDir, "lana-review.csv"), csv.join("\n"));
writeFileSync(join(dataDir, "lana-warnings.txt"), warnings.join("\n"));

const byType = {};
for (const e of out) byType[e.type_id] = (byType[e.type_id] ?? 0) + 1;
const days = new Set(out.map((e) => e.occurred_at.slice(0, 10)));
console.log(JSON.stringify({ entries: out.length, days: days.size, first: out[0]?.occurred_at, last: out[out.length - 1]?.occurred_at, byType, warnings: warnings.length }, null, 1));
