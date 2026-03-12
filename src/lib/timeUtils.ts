import { FARE_CONSTANTS } from "./fareConstants";

/**
 * Time-related utility functions
 */

/**
 * Parse a time string into minutes since midnight
 * Handles special characters like * and ~
 */
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
 * Minutes remaining until a scheduled (or live) time relative to the given Date.
 * Positive = still in the future; negative = already past.
 */
export function computeMinutesUntil(
  currentTime: Date,
  staticTime: string,
  liveTime?: string
): number {
  const nowMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
  return parseTimeToMinutes(liveTime ?? staticTime) - nowMinutes;
}
