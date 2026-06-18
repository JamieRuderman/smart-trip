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
