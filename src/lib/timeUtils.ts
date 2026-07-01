import { FARE_CONSTANTS } from "./fareConstants";

/**
 * Time-related utility functions
 */

/** Convert meters-per-second to whole-number miles-per-hour. */
export function mpsToMph(mps: number): number {
  return Math.round(mps * 2.237);
}

/**
 * Parse a time string into minutes since midnight
 * Handles special characters like * and ~
 */
/** Minutes elapsed since midnight for a Date (0–1439). */
export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function parseTimeToMinutes(timeStr: string): number {
  const cleaned = timeStr.replace(/[*~]/g, "");
  const [h, m] = cleaned.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Clean time string by removing special characters
 */
export function cleanTimeString(timeStr: string): string {
  return timeStr.replace(/[*~]/g, "");
}

/**
 * Calculate the time difference between two time strings in minutes
 */
export function calculateTimeDifference(
  startTime: string,
  endTime: string
): number {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);
  return endMinutes - startMinutes;
}

/**
 * Calculate transfer time between train arrival and ferry departure
 */
export function calculateTransferTime(
  trainTime: string,
  ferryTime: string
): number {
  const cleanTrainTime = cleanTimeString(trainTime);
  const cleanFerryTime = cleanTimeString(ferryTime);

  return calculateTimeDifference(cleanTrainTime, cleanFerryTime);
}

/**
 * Check if a time is in the past compared to current time
 * Handles proper timezone and creates today's date with the specified time
 */
export function isTimeInPast(currentTime: Date, timeString: string): boolean {
  const cleanTime = cleanTimeString(timeString);
  const [hoursStr, minutesStr] = cleanTime.split(":");
  const hours = parseInt(hoursStr, 10);
  const minutes = parseInt(minutesStr, 10);

  // Create a new date for today with the specific time
  const tripTime = new Date(currentTime);
  tripTime.setHours(hours, minutes, 0, 0);

  return tripTime < currentTime;
}

/**
 * Check if a connection time is considered "quick"
 */
export function isQuickConnection(transferTimeMinutes: number): boolean {
  return transferTimeMinutes < FARE_CONSTANTS.QUICK_CONNECTION_THRESHOLD;
}

/**
 * Format a Date as "YYYYMMDD" in local time.
 */
export function formatDateYYYYMMDD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/**
 * Local-time "YYYY-MM-DD" service-date key for a Date. Uses the device's local
 * calendar day (the app treats "today" as the local day), so it is NOT the same
 * as `date.toISOString().slice(0,10)`, which is UTC. Single source of truth for
 * the key that was previously re-derived inline in several components/hooks.
 */
export function toLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Parse a "YYYY-MM-DD" service date into a local-midnight Date. Inverse of
 * {@link toLocalDateKey}. Returns the date at 00:00 local time on that day.
 */
export function parseServiceDate(serviceDate: string): Date {
  const [y, mo, d] = serviceDate.split("-").map(Number);
  return new Date(y, mo - 1, d);
}

/**
 * Weekday name (e.g. "Monday") for a "YYYY-MM-DD" service date, localized to
 * `locale`. Used when showing a future service day instead of bare clock times.
 */
export function serviceDateWeekdayLabel(
  serviceDate: string,
  locale: string
): string {
  return parseServiceDate(serviceDate).toLocaleDateString(locale, {
    weekday: "long",
  });
}

/**
 * Format an absolute epoch (ms) as a locale clock time ("3:42 PM" / "15:42"),
 * honoring the user's 12h/24h preference. Single source of truth for the
 * previously copy-pasted `formatClockTime` helpers.
 */
export function formatClockTime(
  epoch: number,
  timeFormat: "12h" | "24h",
  locale: string
): string {
  return new Date(epoch).toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12: timeFormat === "12h",
  });
}

/** SMART operates in this zone; the GTFS static timetable is in its wall time. */
export const AGENCY_TIME_ZONE = "America/Los_Angeles";

const AGENCY_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: AGENCY_TIME_ZONE,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function agencyParts(epochMs: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of AGENCY_PARTS.formatToParts(epochMs)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  // Intl renders midnight as hour 24; normalize to 0 so arithmetic is sane.
  if (out.hour === 24) out.hour = 0;
  return out;
}

/** Agency-zone (America/Los_Angeles) offset in minutes at a given instant. */
function agencyOffsetMinutes(epochMs: number): number {
  const p = agencyParts(epochMs);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asUTC - epochMs) / 60_000;
}

/**
 * Format an epoch (seconds) as the agency-zone "HH:MM", independent of the
 * device timezone. Used for live GTFS-RT departure times, which must read in
 * SMART's wall time even on an off-Pacific device.
 */
export function agencyClockHHMM(epochSeconds: number): string {
  const p = agencyParts(epochSeconds * 1000);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/**
 * Convert a scheduled agency-zone wall time ("YYYYMMDD" + "HH:MM") to an epoch
 * (seconds), independent of the device timezone. The previous device-local
 * conversion produced wrong delays on a phone set to a non-Pacific zone, since
 * the static timetable is Pacific wall time. (One offset correction; exact
 * except inside the twice-yearly DST transition hour, which has no service.)
 */
export function agencyWallTimeToEpochSeconds(
  yyyymmdd: string,
  hhmm: string
): number {
  const year = Number(yyyymmdd.slice(0, 4));
  const month = Number(yyyymmdd.slice(4, 6));
  const day = Number(yyyymmdd.slice(6, 8));
  const [h, m] = hhmm.split(":").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, h, m);
  const offsetMin = agencyOffsetMinutes(utcGuess);
  return Math.floor((utcGuess - offsetMin * 60_000) / 1000);
}

/**
 * Minutes remaining until a scheduled (or live) time relative to the given Date.
 * Positive = still in the future; negative = already past.
 */
export function computeMinutesUntil(
  currentTime: Date,
  staticTime: string,
  liveTime?: string
): number {
  // The target is a whole-minute clock time (schedule + realtime feed are both
  // HH:MM). Measure the gap from `currentTime` in real seconds and round UP, so
  // the displayed minute reflects the time actually remaining rather than the
  // difference of two truncated clock minutes. (For an exact-minute target the
  // two coincide, but computing from seconds keeps it honest if `currentTime`
  // carries seconds and makes the ceil intent explicit.)
  const targetMs = parseTimeToMinutes(liveTime ?? staticTime) * 60_000;
  const nowMs =
    (currentTime.getHours() * 3_600 +
      currentTime.getMinutes() * 60 +
      currentTime.getSeconds()) *
      1_000 +
    currentTime.getMilliseconds();
  const minutes = Math.ceil((targetMs - nowMs) / 60_000);
  // Math.ceil yields -0 for a target a few seconds in the past; normalize it.
  return minutes === 0 ? 0 : minutes;
}
