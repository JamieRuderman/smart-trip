import type { TFunction } from "i18next";

/**
 * Threshold (minutes) above which realtime feed data is treated as stale.
 * Vehicle positions and trip updates poll every 15-30s, so anything older
 * than 10 minutes implies the polling has stopped — usually a network drop.
 */
export const REALTIME_STALE_THRESHOLD_MIN = 10;

/**
 * Format a "last updated X ago" label using the same wording the schedule
 * header uses. Returns the rendered string and a stale flag so the caller
 * can color-code or attach an icon without re-implementing the threshold.
 */
export function computeRealtimeAgeLabel(
  t: TFunction,
  lastUpdated: Date | null,
  currentTime: Date,
): { text: string; isStale: boolean } {
  if (!lastUpdated) {
    return { text: t("schedule.lastUpdatedLoading"), isStale: false };
  }
  const diffMin = Math.floor(
    (currentTime.getTime() - lastUpdated.getTime()) / 60000,
  );
  if (diffMin < 1) {
    return { text: t("schedule.updatedJustNow"), isStale: false };
  }
  const relative = t("schedule.updatedMinutesAgo", { count: diffMin });
  if (diffMin >= REALTIME_STALE_THRESHOLD_MIN) {
    return {
      text: `${relative} ${t("schedule.dataMayBeStale")}`,
      isStale: true,
    };
  }
  return { text: relative, isStale: false };
}
