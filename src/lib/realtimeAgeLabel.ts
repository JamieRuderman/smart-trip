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

export type RealtimeAgeTone = "fresh" | "stale" | "unavailable";

/**
 * Format a "last updated X ago" label. Returns the rendered string and a
 * `tone` discriminator so the caller can swap icons / color-code without
 * re-implementing the threshold.
 *
 * Tones:
 *   - "fresh":       "Loading…" / "Just now" / "Xm ago" — refresh icon, normal text
 *   - "stale":       "Stale"                            — warning icon + gold text
 *   - "unavailable": "Unavailable"                      — warning icon, normal text
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
): { text: string; tone: RealtimeAgeTone } {
  if (!lastUpdated) {
    if (isError) {
      return { text: t("schedule.realtimeUnavailable"), tone: "unavailable" };
    }
    return { text: t("schedule.lastUpdatedLoading"), tone: "fresh" };
  }
  const diffMin = Math.floor(
    (currentTime.getTime() - lastUpdated.getTime()) / 60000,
  );
  if (diffMin >= REALTIME_STALE_THRESHOLD_MIN) {
    return { text: t("schedule.stale"), tone: "stale" };
  }
  if (diffMin < 1) {
    return { text: t("schedule.updatedJustNow"), tone: "fresh" };
  }
  return {
    text: t("schedule.updatedMinutesAgo", { count: diffMin }),
    tone: "fresh",
  };
}
