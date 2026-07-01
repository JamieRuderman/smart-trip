import { computeMinutesUntil } from "@/lib/timeUtils";

/**
 * Minutes remaining until a departure, derived purely from `currentTime`.
 * Returns a negative number once the train has departed.
 *
 * No internal timer: the value is whole minutes and every caller passes the
 * app-wide `currentTime` clock, which already ticks on the minute boundary
 * (and resyncs on foreground) — so the countdown re-renders exactly when the
 * minute flips. An earlier version ran a 10s `setInterval` that recomputed
 * against the same frozen `currentTime`, so it never advanced between the
 * parent's minute ticks; dropping it removes a stale-closure trap and a timer.
 */
export function useCountdown(
  departureTimeStr: string,
  liveDepTime: string | undefined,
  currentTime: Date
): number {
  return computeMinutesUntil(currentTime, departureTimeStr, liveDepTime);
}
