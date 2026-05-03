import type { TFunction } from "i18next";

/**
 * Threshold (minutes) above which realtime feed data is treated as stale.
 * Vehicle positions and trip updates poll every 15-30s, so anything older
 * than 10 minutes implies the polling has stopped — usually a network drop.
 */
export const REALTIME_STALE_THRESHOLD_MIN = 10;

const MIN_PER_HOUR = 60;
const MIN_PER_DAY = 60 * 24;

function relativeAgo(t: TFunction, diffMin: number): string {
  if (diffMin < MIN_PER_HOUR) {
    return t("schedule.updatedMinutesAgo", { count: diffMin });
  }
  if (diffMin < MIN_PER_DAY) {
    return t("schedule.updatedHoursAgo", {
      count: Math.floor(diffMin / MIN_PER_HOUR),
    });
  }
  return t("schedule.updatedDaysAgo", {
    count: Math.floor(diffMin / MIN_PER_DAY),
  });
}

/**
 * Format a "last updated X ago" label using the same wording the schedule
 * header uses. Returns the rendered string and a stale flag so the caller
 * can color-code or attach an icon without re-implementing the threshold.
 *
 * The unit steps up from minutes → hours → days so the label stays compact
 * for old data (e.g. "70d ago" instead of "101037m ago").
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
  const relative = relativeAgo(t, diffMin);
  if (diffMin >= REALTIME_STALE_THRESHOLD_MIN) {
    return {
      text: `${relative} ${t("schedule.dataMayBeStale")}`,
      isStale: true,
    };
  }
  return { text: relative, isStale: false };
}
