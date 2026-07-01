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
 * Format a "last updated X ago" label. Returns the rendered string, an
 * `isStale` flag, and an `isUnavailable` flag so the caller can swap icons /
 * color-code without re-implementing the thresholds.
 *
 * Three states:
 *   - fresh (`isStale=false`):                 "Just now" or "Xm ago"
 *   - stale (`isStale=true`):                  "Stale"
 *   - unavailable (`isUnavailable=true`):      "Live data unavailable"
 *
 * The unavailable state only fires when the feed is failing AND we have no
 * timestamp to show (never fetched, or the cached data was cleared). `feedFailing`
 * is any fetch failure — a 511 outage, our own API erroring, or a network drop —
 * not just a 502, so a cold start with no data reads "unavailable" rather than a
 * perpetual "loading". When we still have a timestamp we keep showing its age —
 * the data is real, just aging — and let it cross into "Stale" naturally.
 */
export function computeRealtimeAgeLabel(
  t: TFunction,
  lastUpdated: Date | null,
  currentTime: Date,
  feedFailing = false,
): { text: string; isStale: boolean; isUnavailable: boolean } {
  if (!lastUpdated) {
    if (feedFailing) {
      return {
        text: t("schedule.liveDataUnavailable"),
        isStale: true,
        isUnavailable: true,
      };
    }
    return {
      text: t("schedule.lastUpdatedLoading"),
      isStale: false,
      isUnavailable: false,
    };
  }
  const diffMin = Math.floor(
    (currentTime.getTime() - lastUpdated.getTime()) / 60000,
  );
  if (diffMin >= REALTIME_STALE_THRESHOLD_MIN) {
    return { text: t("schedule.stale"), isStale: true, isUnavailable: false };
  }
  if (diffMin < 1) {
    return {
      text: t("schedule.updatedJustNow"),
      isStale: false,
      isUnavailable: false,
    };
  }
  return {
    text: t("schedule.updatedMinutesAgo", { count: diffMin }),
    isStale: false,
    isUnavailable: false,
  };
}
