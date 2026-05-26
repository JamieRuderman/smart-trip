import type { TFunction } from "i18next";

/**
 * Realtime feeds (vehicle positions, trip updates) poll every 15-30s, so
 * anything older than this is broken polling — offline, suspended app, or
 * upstream outage. Past the threshold the precise minute count is noise:
 * the user just needs to know "don't trust this", so we collapse to "Stale"
 * + warning icon. Below the threshold we show the count, which lets the
 * user calibrate borderline cases ("12m ago" vs "47m ago" feel different).
 */
export const REALTIME_STALE_THRESHOLD_MIN = 60;

/**
 * Format a "last updated X ago" label. Returns the rendered string and a
 * `isStale` flag so the caller can swap icons / color-code without
 * re-implementing the threshold.
 *
 * States:
 *   - loading (no data yet, no error):  "Loading…"            (isStale=false)
 *   - unavailable (no data, fetch errored): "Unavailable"     (isStale=true)
 *   - fresh:                                 "Just now" / "Xm ago"
 *   - stale (data older than threshold):     "Stale"          (isStale=true)
 *
 * When `lastUpdated` is set we always trust the age label even if the latest
 * poll failed — react-query keeps cached data, and a brief network blip
 * shouldn't flip a working UI into a warning state. The stale threshold
 * handles sustained outages.
 */
export function computeRealtimeAgeLabel(
  t: TFunction,
  lastUpdated: Date | null,
  currentTime: Date,
  isError = false,
): { text: string; isStale: boolean } {
  if (!lastUpdated) {
    if (isError) {
      return { text: t("schedule.realtimeUnavailable"), isStale: true };
    }
    return { text: t("schedule.lastUpdatedLoading"), isStale: false };
  }
  const diffMin = Math.floor(
    (currentTime.getTime() - lastUpdated.getTime()) / 60000,
  );
  if (diffMin >= REALTIME_STALE_THRESHOLD_MIN) {
    return { text: t("schedule.stale"), isStale: true };
  }
  if (diffMin < 1) {
    return { text: t("schedule.updatedJustNow"), isStale: false };
  }
  return {
    text: t("schedule.updatedMinutesAgo", { count: diffMin }),
    isStale: false,
  };
}
