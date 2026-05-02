import { describe, expect, it } from "vitest";

import {
  computeRealtimeAgeLabel,
  REALTIME_STALE_THRESHOLD_MIN,
} from "@/lib/realtimeAgeLabel";

// Minimal i18next-style stub: returns the key + a serialised options blob,
// which is enough for snapshot-style assertions without pulling in i18next.
const t = ((key: string, options?: { count?: number }): string => {
  if (options && options.count != null) return `${key}[${options.count}]`;
  return key;
}) as Parameters<typeof computeRealtimeAgeLabel>[0];

const NOW = new Date("2026-05-02T12:00:00Z");

function minutesAgo(min: number): Date {
  return new Date(NOW.getTime() - min * 60_000);
}

describe("computeRealtimeAgeLabel", () => {
  it("returns the loading label when lastUpdated is null", () => {
    const result = computeRealtimeAgeLabel(t, null, NOW);
    expect(result).toEqual({
      text: "schedule.lastUpdatedLoading",
      isStale: false,
    });
  });

  it("returns 'just now' for sub-minute deltas", () => {
    const result = computeRealtimeAgeLabel(t, minutesAgo(0), NOW);
    expect(result).toEqual({
      text: "schedule.updatedJustNow",
      isStale: false,
    });
  });

  it("returns 'X min ago' for fresh-but-not-instant data", () => {
    const result = computeRealtimeAgeLabel(t, minutesAgo(3), NOW);
    expect(result).toEqual({
      text: "schedule.updatedMinutesAgo[3]",
      isStale: false,
    });
  });

  it("appends the stale suffix once past the threshold", () => {
    const result = computeRealtimeAgeLabel(
      t,
      minutesAgo(REALTIME_STALE_THRESHOLD_MIN),
      NOW,
    );
    expect(result.isStale).toBe(true);
    expect(result.text).toContain("schedule.dataMayBeStale");
  });
});
