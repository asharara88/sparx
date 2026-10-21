/**
 * The simple screen and the voice helper in English, Arabic and Russian. Only what those two
 * surfaces say; the rest of the app stays in English. Keep keys short and sentences plain.
 */
export type Lang = "en" | "ar" | "ru";

const STRINGS = {
  en: {
    title: "Lana",
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
    todayText: "Today Lana had {feeds} feeds, {diapers} diaper changes and {sleeps} sleeps.",
    asleepNow: "She is asleep now.",
    awakeNow: "She is awake now.",
  },
  ar: {
    title: "لانا",
    asleep: "نائمة منذ",
    awake: "مستيقظة",
    awakeSince: "مستيقظة منذ",
    feeding: "ترضع",
    lastFeed: "آخر رضعة",
    lastDiaper: "آخر حفاض",
    bottle: "رضّاعة",
    diaper: "حفاض",
    wet: "مبلول",
    dirty: "متسخ",
    both: "الاثنان",
    fellAsleep: "نامت",
    wokeUp: "استيقظت",
    note: "ملاحظة",
    noteHint: "قولي أو اكتبي ما حدث",
    save: "حفظ",
    cancel: "إلغاء",
    saved: "تم الحفظ",
    ask: "اسألي",
    fullScreen: "الشاشة الكاملة",
    simpleScreen: "الشاشة المبسطة",
    language: "اللغة",
    readAloud: "اقرأ الإجابات بصوت عالٍ",
    speak: "تكلمي",
    listening: "أستمع…",
    ago: "مضت",
    milkInFridge: "في الثلاجة",
    hungryNow: "لانا غالبًا جعانة دلوقتي",
    hungrySoon: "لانا هتجوع قريب",
    sleepyNow: "لانا غالبًا نعسانة دلوقتي",
    sleepySoon: "لانا هتنعس قريب",
    listen: "اسمعي يوم لانا",
    todayText: "النهارده لانا رضعت {feeds} مرات، واتغير لها البامبرز {diapers} مرات، ونامت {sleeps} مرات.",
    asleepNow: "هي نايمة دلوقتي.",
    awakeNow: "هي صاحية دلوقتي.",
  },
  ru: {
    title: "Лана",
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
    wokeUp: "Проснулась",
    note: "Заметка",
    noteHint: "Скажите или напишите, что случилось",
    save: "Сохранить",
    cancel: "Отмена",
    saved: "Сохранено",
    ask: "Спросить",
    fullScreen: "Полный экран",
    simpleScreen: "Простой экран",
    language: "Язык",
    readAloud: "Читать ответы вслух",
    speak: "Говорите",
    listening: "Слушаю…",
    ago: "назад",
    milkInFridge: "в холодильнике",
    hungryNow: "Лана, наверное, голодна",
    hungrySoon: "Скоро захочет есть",
    sleepyNow: "Лана, наверное, хочет спать",
    sleepySoon: "Скоро захочет спать",
    listen: "Послушать про сегодня",
    todayText: "Сегодня Лана поела {feeds} раз, подгузник меняли {diapers} раз, она спала {sleeps} раз.",
    asleepNow: "Сейчас она спит.",
    awakeNow: "Сейчас она не спит.",
  },
} as const;

export type Key = keyof (typeof STRINGS)["en"];

export function t(lang: Lang | undefined, key: Key): string {
  return STRINGS[lang ?? "en"][key] ?? STRINGS.en[key];
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
