import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { FARE_CONSTANTS } from "./fareConstants";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Creates an interval that updates every minute
 */
export function createMinuteInterval(callback: () => void): () => void {
  const interval = setInterval(callback, FARE_CONSTANTS.MINUTE_UPDATE_INTERVAL);
  return () => clearInterval(interval);
}
