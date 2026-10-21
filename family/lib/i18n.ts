/**
 * The simple screen and the voice helper in English, Arabic and Russian. Only what those two
 * surfaces say; the rest of the app stays in English. Keep keys short and sentences plain.
 *
 * The child's name is never in a string: `{child}` is filled in from the household's data
 * (the name in that language when the household gave one). Where Arabic or Russian changes
 * with the child's sex, the string for a boy sits under the same key with `_m`; the default
 * reads for a girl, as the first household's did.
 */
export type Lang = "en" | "ar" | "ru";

const STRINGS = {
  en: {
    title: "{child}",
    asleep: "Asleep since",
    awake: "Awake",
    awakeSince: "Awake since",
    feeding: "Feeding",
    lastFeed: "Last feed",
    lastDiaper: "Last diaper",
    bottle: "Bottle",
    diaper: "Diaper",
    wet: "Wet",
    dirty: "Dirty",
    both: "Both",
    fellAsleep: "Fell asleep",
    wokeUp: "Woke up",
    note: "Note",
    noteHint: "Say or write what happened",
    save: "Save",
    cancel: "Cancel",
    saved: "Saved",
    savedOffline: "Saved on this phone. It will send when back online.",
    ask: "Ask",
    fullScreen: "Full screen",
    simpleScreen: "Simple screen",
    language: "Language",
    readAloud: "Read answers aloud",
    speak: "Speak",
    listening: "Listening…",
    ago: "ago",
    milkInFridge: "in the fridge",
    hungryNow: "Probably hungry now",
    hungrySoon: "Hungry soon",
    sleepyNow: "Probably sleepy now",
    sleepySoon: "Sleepy soon",
    listen: "Listen to today",
    todayText: "Today {child} had {feeds} feeds, {diapers} diaper changes and {sleeps} sleeps.",
    asleepNow: "She is asleep now.",
    asleepNow_m: "He is asleep now.",
    awakeNow: "She is awake now.",
    awakeNow_m: "He is awake now.",
  },
  ar: {
    title: "{child}",
    asleep: "نائمة منذ",
    asleep_m: "نائم منذ",
    awake: "مستيقظة",
    awake_m: "مستيقظ",
    awakeSince: "مستيقظة منذ",
    awakeSince_m: "مستيقظ منذ",
    feeding: "ترضع",
    feeding_m: "يرضع",
    lastFeed: "آخر رضعة",
    lastDiaper: "آخر حفاض",
    bottle: "رضّاعة",
    diaper: "حفاض",
    wet: "مبلول",
    dirty: "متسخ",
    both: "الاثنان",
    fellAsleep: "نامت",
    fellAsleep_m: "نام",
    wokeUp: "استيقظت",
    wokeUp_m: "استيقظ",
    note: "ملاحظة",
    noteHint: "قولي أو اكتبي ما حدث",
    save: "حفظ",
    cancel: "إلغاء",
    saved: "تم الحفظ",
    savedOffline: "تم الحفظ على هذا الهاتف، وسيُرسَل عند عودة الإنترنت.",
    ask: "اسألي",
    fullScreen: "الشاشة الكاملة",
    simpleScreen: "الشاشة المبسطة",
    language: "اللغة",
    readAloud: "اقرأ الإجابات بصوت عالٍ",
    speak: "تكلمي",
    listening: "أستمع…",
    ago: "مضت",
    milkInFridge: "في الثلاجة",
    hungryNow: "{child} غالبًا جعانة دلوقتي",
    hungryNow_m: "{child} غالبًا جعان دلوقتي",
    hungrySoon: "{child} هتجوع قريب",
    hungrySoon_m: "{child} هيجوع قريب",
    sleepyNow: "{child} غالبًا نعسانة دلوقتي",
    sleepyNow_m: "{child} غالبًا نعسان دلوقتي",
    sleepySoon: "{child} هتنعس قريب",
    sleepySoon_m: "{child} هينعس قريب",
    listen: "اسمعي يوم {child}",
    todayText: "النهارده {child} رضعت {feeds} مرات، واتغير لها البامبرز {diapers} مرات، ونامت {sleeps} مرات.",
    todayText_m: "النهارده {child} رضع {feeds} مرات، واتغير له البامبرز {diapers} مرات، ونام {sleeps} مرات.",
    asleepNow: "هي نايمة دلوقتي.",
    asleepNow_m: "هو نايم دلوقتي.",
    awakeNow: "هي صاحية دلوقتي.",
    awakeNow_m: "هو صاحي دلوقتي.",
  },
  ru: {
    title: "{child}",
    asleep: "Спит с",
    awake: "Не спит",
    awakeSince: "Не спит с",
    feeding: "Кормление",
    lastFeed: "Последнее кормление",
    lastDiaper: "Последний подгузник",
    bottle: "Бутылочка",
    diaper: "Подгузник",
    wet: "Мокрый",
    dirty: "Грязный",
    both: "Оба",
    fellAsleep: "Уснула",
    fellAsleep_m: "Уснул",
    wokeUp: "Проснулась",
    wokeUp_m: "Проснулся",
    note: "Заметка",
    noteHint: "Скажите или напишите, что случилось",
    save: "Сохранить",
    cancel: "Отмена",
    saved: "Сохранено",
    savedOffline: "Сохранено на этом телефоне. Отправится, когда появится интернет.",
    ask: "Спросить",
    fullScreen: "Полный экран",
    simpleScreen: "Простой экран",
    language: "Язык",
    readAloud: "Читать ответы вслух",
    speak: "Говорите",
    listening: "Слушаю…",
    ago: "назад",
    milkInFridge: "в холодильнике",
    hungryNow: "{child}, наверное, голодна",
    hungryNow_m: "{child}, наверное, голоден",
    hungrySoon: "Скоро захочет есть",
    sleepyNow: "{child}, наверное, хочет спать",
    sleepySoon: "Скоро захочет спать",
    listen: "Послушать про сегодня",
    todayText: "Сегодня {child} поела {feeds} раз, подгузник меняли {diapers} раз, она спала {sleeps} раз.",
    todayText_m: "Сегодня {child} поел {feeds} раз, подгузник меняли {diapers} раз, он спал {sleeps} раз.",
    asleepNow: "Сейчас она спит.",
    asleepNow_m: "Сейчас он спит.",
    awakeNow: "Сейчас она не спит.",
    awakeNow_m: "Сейчас он не спит.",
  },
} as const;

export type Key = keyof (typeof STRINGS)["en"] extends infer K ? Exclude<K, `${string}_m`> : never;

export interface Vars {
  /** The child's name in this language. */
  child?: string;
  /** "Girl" or "Boy" (anything else reads as the default form). */
  sex?: string | null;
  [k: string]: string | number | null | undefined;
}

/** A string in the member's language with the names filled in; falls back to English. */
export function t(lang: Lang | undefined, key: Key, vars: Vars = {}): string {
  const table = STRINGS[lang ?? "en"] as Record<string, string>;
  const male = /^(boy|male|m)$/i.test(String(vars.sex ?? ""));
  const raw = (male && table[`${key}_m`]) || table[key] || (male && (STRINGS.en as Record<string, string>)[`${key}_m`]) || STRINGS.en[key];
  return raw.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] == null ? (k === "child" ? "the baby" : m) : String(vars[k])));
}
export const LANGS: { id: Lang; label: string; speech: string; dir: "ltr" | "rtl" }[] = [
  { id: "en", label: "English", speech: "en-GB", dir: "ltr" },
  { id: "ar", label: "العربية", speech: "ar-AE", dir: "rtl" },
  { id: "ru", label: "Русский", speech: "ru-RU", dir: "ltr" },
];
export function speechLang(lang: Lang | undefined): string {
  return LANGS.find((l) => l.id === lang)?.speech ?? "en-GB";
}
export function dirOf(lang: Lang | undefined): "ltr" | "rtl" {
  return LANGS.find((l) => l.id === lang)?.dir ?? "ltr";
}
/** "2 h 10 min" in the member's language, from minutes. */
export function fmtAgo(lang: Lang | undefined, minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  const units = lang === "ar" ? { h: "س", m: "د" } : lang === "ru" ? { h: "ч", m: "мин" } : { h: "h", m: "min" };
  const text = h ? `${h} ${units.h}${r ? ` ${r} ${units.m}` : ""}` : `${r} ${units.m}`;
  return lang === "ar" ? `منذ ${text}` : lang === "ru" ? `${text} назад` : `${text} ago`;
}
