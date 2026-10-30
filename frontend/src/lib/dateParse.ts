/**
 * Natural-language date/time parsing and presets for Send Later and Snooze.
 * Everything is relative to a `now` argument so it is deterministic in tests.
 */

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const DEFAULT_HOUR = 9;
const DAY_PARTS: Record<string, number> = { morning: 9, noon: 12, afternoon: 14, evening: 18, night: 20, tonight: 20 };

function lookup(list: string[], word: string): number {
  if (word.length < 3) return -1;
  return list.findIndex((n) => n === word || (word.length >= 3 && n.startsWith(word) && word.length <= n.length));
}

function at(base: Date, hour: number, minute = 0): Date {
  const d = new Date(base);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

/** Next date (strictly after today) falling on the given weekday (0 = Sunday) */
function nextWeekday(now: Date, dow: number): Date {
  const diff = (dow - now.getDay() + 7) % 7 || 7;
  return addDays(now, diff);
}

interface Time {
  hour: number;
  minute: number;
}

/** Pull a clock time ("3pm", "9:30 am", "15:30") out of the text */
function extractTime(text: string): { time: Time | null; rest: string } {
  let m = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)\b/);
  if (m) {
    let hour = parseInt(m[1], 10);
    const minute = m[2] ? parseInt(m[2], 10) : 0;
    if (hour < 1 || hour > 12 || minute > 59) return { time: null, rest: text };
    const pm = m[3].startsWith("p");
    hour = (hour % 12) + (pm ? 12 : 0);
    return { time: { hour, minute }, rest: text.replace(m[0], " ") };
  }
  m = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (m) {
    return { time: { hour: parseInt(m[1], 10), minute: parseInt(m[2], 10) }, rest: text.replace(m[0], " ") };
  }
  if (/\bnoon\b/.test(text)) return { time: { hour: 12, minute: 0 }, rest: text.replace(/\bnoon\b/, " ") };
  return { time: null, rest: text };
}

function relativeOffset(text: string, now: Date): Date | null {
  const m = text.match(/^(?:in\s+)?(an?|\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|wks?|weeks?)$/);
  if (!m) return null;
  const n = m[1].startsWith("a") ? 1 : parseFloat(m[1]);
  const unit = m[2][0];
  if (!/^in\s/.test(text) && !/^\d/.test(text)) return null;
  const d = new Date(now);
  if (unit === "m") d.setTime(d.getTime() + n * 60_000);
  else if (unit === "h") d.setTime(d.getTime() + n * 3_600_000);
  else if (unit === "d") d.setDate(d.getDate() + Math.round(n));
  else d.setDate(d.getDate() + Math.round(n * 7));
  return d;
}

/**
 * Parse text like "tomorrow 9am", "fri 3pm", "in 2 hours", "next monday", "dec 25 8:30am", "12/25".
 * Returns a future Date or null when the text isn't understood (or is in the past).
 */
export function parseWhen(input: string, now: Date = new Date()): Date | null {
  let text = input.trim().toLowerCase().replace(/[,]/g, " ").replace(/\bat\b/g, " ").replace(/\s+/g, " ");
  if (!text) return null;

  const rel = relativeOffset(text, now);
  if (rel) return rel.getTime() > now.getTime() ? rel : null;

  const { time, rest } = extractTime(text);
  text = rest.trim().replace(/\s+/g, " ");
  const words = text ? text.split(" ") : [];

  // Time-of-day words (morning, afternoon, tonight...)
  let partHour: number | null = null;
  const remaining: string[] = [];
  for (const w of words) {
    if (w in DAY_PARTS) partHour = DAY_PARTS[w];
    else remaining.push(w);
  }
  const hasTime = time !== null;
  const hour = time ? time.hour : partHour;
  const minute = time ? time.minute : 0;
  const words2 = remaining.filter((w) => w !== "this" || remaining.length === 1);

  let date: Date | null = null;
  let timeOnly = false;
  const joined = words2.join(" ");

  if (joined === "" || joined === "today" || joined === "tonight") {
    if (joined === "" && hour === null) return null;
    date = new Date(now);
    timeOnly = joined === "";
    if (words.includes("tonight") && hour === null) return at(now, 20) > now ? at(now, 20) : null;
  } else if (joined === "tomorrow" || joined === "tmrw" || joined === "tom") {
    date = addDays(now, 1);
  } else if (joined === "weekend" || joined === "this weekend") {
    date = nextWeekday(now, 6);
    if (hour === null) return at(date, 10);
  } else if (joined === "next week") {
    date = nextWeekday(now, 1);
  } else if (joined === "next month") {
    date = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  } else {
    const m = joined.match(/^(?:(next)\s+)?([a-z]+)$/);
    const dow = m ? lookup(WEEKDAYS, m[2]) : -1;
    if (m && dow >= 0) {
      date = now.getDay() === dow && !m[1] && hour !== null && at(now, hour, minute) > now ? new Date(now) : nextWeekday(now, dow);
    } else {
      date = parseCalendarDate(joined, now);
    }
  }
  if (!date) return null;

  const h = hour ?? (timeOnly ? now.getHours() : DEFAULT_HOUR);
  let result = at(date, h, minute);

  if (timeOnly && hasTime && result <= now) result = addDays(result, 1);
  return result.getTime() > now.getTime() ? result : null;
}

/** "dec 25", "25 dec", "december 25 2026", "12/25", "12/25/2026", "2026-12-25" */
function parseCalendarDate(text: string, now: Date): Date | null {
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return validDate(+m[1], +m[2] - 1, +m[3]);

  m = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (m) return resolveYear(+m[1] - 1, +m[2], m[3] ? fullYear(+m[3]) : null, now);

  m = text.match(/^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/);
  if (m) {
    const month = lookup(MONTHS, m[1]);
    if (month >= 0) return resolveYear(month, +m[2], m[3] ? +m[3] : null, now);
  }
  m = text.match(/^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)\.?(?: (\d{4}))?$/);
  if (m) {
    const month = lookup(MONTHS, m[2]);
    if (month >= 0) return resolveYear(month, +m[1], m[3] ? +m[3] : null, now);
  }
  return null;
}

function fullYear(y: number): number {
  return y < 100 ? 2000 + y : y;
}

function validDate(year: number, month: number, day: number): Date | null {
  const d = new Date(year, month, day);
  return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day ? d : null;
}

/** Without an explicit year, use this year unless the date has passed, then next year */
function resolveYear(month: number, day: number, year: number | null, now: Date): Date | null {
  if (year !== null) return validDate(year, month, day);
  const thisYear = validDate(now.getFullYear(), month, day);
  if (thisYear && at(thisYear, 23, 59) > now) return thisYear;
  return validDate(now.getFullYear() + 1, month, day);
}

export interface WhenPreset {
  key: string;
  id: string;
  label: string;
  date: Date;
}

/** Single-key presets shared by Send Later and Snooze; presets already in the past are omitted */
export function whenPresets(now: Date = new Date()): WhenPreset[] {
  const hour = now.getHours();
  const presets: WhenPreset[] = [];
  const push = (id: string, label: string, date: Date) => {
    if (date.getTime() > now.getTime()) presets.push({ key: String(presets.length + 1), id, label, date });
  };
  push("later", "Later today", hour < 17 ? at(now, 17) : at(now, 20));
  push("tomorrow", "Tomorrow morning", at(addDays(now, 1), 9));
  push("tomorrow-pm", "Tomorrow afternoon", at(addDays(now, 1), 14));
  push("weekend", "This weekend", at(nextWeekday(now, 6), 10));
  push("monday", "Next Monday", at(nextWeekday(now, 1), 9));
  return presets;
}

/** "3:00 PM", "Tomorrow, 9:00 AM", "Fri, Nov 6, 3:00 PM" */
export function formatWhen(date: Date, now: Date = new Date()): string {
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return `Today, ${time}`;
  if (date.toDateString() === addDays(now, 1).toDateString()) return `Tomorrow, ${time}`;
  const withinWeek = date.getTime() - now.getTime() < 6 * 86_400_000;
  const day = date.toLocaleDateString([], withinWeek ? { weekday: "short" } : { weekday: "short", month: "short", day: "numeric" });
  return `${day}, ${time}`;
}

export const toUnix = (d: Date): number => Math.floor(d.getTime() / 1000);
