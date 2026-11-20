// Local wall-clock helpers. Bookings are stored as "YYYY-MM-DDTHH:mm"
// strings in company-local time, so all comparisons below are plain
// string comparisons — exact and timezone-proof, across day spans too.

export const DAY_START_MIN = 7 * 60; // calendar time grid runs 07:00 – 23:00
export const DAY_END_MIN = 23 * 60;
export const SNAP_MIN = 30;

const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function isValidStamp(value: unknown): value is string {
  if (typeof value !== "string" || !STAMP_RE.test(value)) return false;
  const [datePart, timePart] = value.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) return false;
  const probe = new Date(y, m - 1, d);
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
}

export function stampToMinutes(stamp: string): number {
  const hh = Number(stamp.slice(11, 13));
  const mm = Number(stamp.slice(14, 16));
  return hh * 60 + mm;
}

export function minutesToStampTime(totalMin: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, totalMin));
  const hh = String(Math.floor(clamped / 60)).padStart(2, "0");
  const mm = String(clamped % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function todayDatePart(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function nowStamp(): string {
  const now = new Date();
  return `${todayDatePart()}T${minutesToStampTime(now.getHours() * 60 + now.getMinutes())}`;
}

/** "Now" as seen on the wall in a given IANA timezone, as a stamp. */
export function nowStampInZone(timeZone: string): string {
  return stampFromEpochInZone(Date.now(), timeZone);
}

/** A moment (epoch ms) rendered as a wall-clock stamp in a timezone. */
export function stampFromEpochInZone(epochMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(epochMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

/** True when the timezone string is one ICU knows. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function addDays(datePart: string, days: number): string {
  const [y, m, d] = datePart.split("-").map(Number);
  const probe = new Date(y, m - 1, d + days);
  const py = probe.getFullYear();
  const pm = String(probe.getMonth() + 1).padStart(2, "0");
  const pd = String(probe.getDate()).padStart(2, "0");
  return `${py}-${pm}-${pd}`;
}

/** Add minutes to a stamp; rolls over midnight correctly (up to 999 days). */
export function addMinutes(stamp: string, minutes: number): string {
  const total = stampToMinutes(stamp) + minutes;
  const dayOffset = Math.floor(total / (24 * 60));
  const within = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${addDays(stamp.slice(0, 10), dayOffset)}T${minutesToStampTime(within)}`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function weekdayShort(datePart: string): string {
  return WEEKDAYS_SHORT[weekdayIndex(datePart)];
}

export function weekdayIndex(datePart: string): number {
  const [y, m, d] = datePart.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

export function monthLabel(year: number, monthIndex: number): string {
  return `${MONTHS[monthIndex]} ${year}`;
}

export function prettyDate(datePart: string): string {
  const [y, m, d] = datePart.split("-").map(Number);
  const probe = new Date(y, m - 1, d);
  return `${WEEKDAYS[probe.getDay()]}, ${MONTHS_SHORT[m - 1]} ${d}`;
}

export function prettyDateLong(datePart: string): string {
  const [y, m, d] = datePart.split("-").map(Number);
  const probe = new Date(y, m - 1, d);
  return `${WEEKDAYS[probe.getDay()]}, ${MONTHS[m - 1]} ${d}, ${y}`;
}

/** "10:00 – 13:00" or a multi-day range "Nov 9, 10:00 → Nov 11, 14:00". */
export function prettyStampRange(start: string, end: string): string {
  const startDay = start.slice(0, 10);
  const endDay = end.slice(0, 10);
  if (startDay === endDay) {
    return `${start.slice(11, 16)} – ${end.slice(11, 16)}`;
  }
  const days = Math.round((parseDay(endDay) - parseDay(startDay)) / 86400000) + 1;
  const dayLabel = days === 2 ? "overnight" : `${days} days`;
  return `${shortDate(startDay)} ${start.slice(11, 16)} → ${shortDate(endDay)} ${end.slice(11, 16)} (${dayLabel})`;
}

/** "12h" clock string like "10:00 am"; keeps "14:30" for 24h. */
export function prettyTime(hhmm: string, format: "12h" | "24h"): string {
  if (format === "24h") return hhmm;
  const [hStr, mStr] = hhmm.split(":").map(Number);
  const suffix = hStr >= 12 ? "pm" : "am";
  const h12 = hStr % 12 === 0 ? 12 : hStr % 12;
  return `${h12}:${String(mStr ?? 0).padStart(2, "0")} ${suffix}`;
}

/** The wall-clock house style: 24-hour stamps wearing their unit — "13:00 HRS". */
export function hrsLabel(hhmm: string): string {
  return `${hhmm} HRS`;
}

/** The same moment said the other way — "1:30 PM" — for the live clock chip. */
export function pmLabel(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":").map(Number);
  const suffix = hStr >= 12 ? "PM" : "AM";
  const h12 = hStr % 12 === 0 ? 12 : hStr % 12;
  return `${h12}:${String(mStr ?? 0).padStart(2, "0")} ${suffix}`;
}

/**
 * A booking window with the units spelled out: same-day reads
 * "10:00 – 13:00 HRS"; a multi-day span reads
 * "Nov 17 21:00 HRS → Nov 20 06:00 HRS (4 days)".
 */
export function hrsRange(start: string, end: string): string {
  const startDay = start.slice(0, 10);
  const endDay = end.slice(0, 10);
  if (startDay === endDay) {
    return `${start.slice(11, 16)} – ${end.slice(11, 16)} HRS`;
  }
  return `${shortDate(startDay)} ${start.slice(11, 16)} HRS → ${shortDate(endDay)} ${end.slice(11, 16)} HRS (${spanDays(start, end)} days)`;
}

function parseDay(datePart: string): number {
  const [y, m, d] = datePart.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function shortDate(datePart: string): string {
  const [, m] = datePart.split("-").map(Number);
  return `${MONTHS_SHORT[m - 1]} ${Number(datePart.slice(8, 10))}`;
}

export function prettyRange(start: string, end: string): string {
  return `${start.slice(11, 16)} – ${end.slice(11, 16)}`;
}

export function isPast(stamp: string): boolean {
  return stamp < nowStamp();
}

/** Whole days a booking covers, counting both ends. */
export function spanDays(start: string, end: string): number {
  const days = Math.round((parseDay(end.slice(0, 10)) - parseDay(start.slice(0, 10))) / 86400000) + 1;
  return Math.max(1, days);
}

export function prettyDuration(start: string, end: string): string {
  const totalMin =
    spanDays(start, end) * 24 * 60 - stampToMinutes(start) + stampToMinutes(end) - 24 * 60;
  const days = Math.floor(totalMin / (24 * 60));
  const hours = Math.floor((totalMin % (24 * 60)) / 60);
  const mins = totalMin % 60;
  if (days > 0) {
    const hourPart = hours > 0 ? ` ${hours}h` : "";
    return `${days}d${hourPart}`;
  }
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}
