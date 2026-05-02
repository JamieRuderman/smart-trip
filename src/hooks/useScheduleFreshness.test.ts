import { describe, expect, it } from "vitest";

import {
  computeScheduleFreshness,
  SCHEDULE_STALE_DAYS,
  SCHEDULE_WARN_DAYS,
} from "@/hooks/useScheduleFreshness";

const NOW = new Date("2026-05-02T12:00:00Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 86_400_000);
}

describe("computeScheduleFreshness", () => {
  it("flags missing generatedAt as warn", () => {
    const result = computeScheduleFreshness(null, "remote", NOW);
    expect(result.severity).toBe("warn");
    expect(result.ageDays).toBeNull();
  });

  it("treats today's remote data as fresh", () => {
    const result = computeScheduleFreshness(daysAgo(0), "remote", NOW);
    expect(result.severity).toBe("fresh");
    expect(result.ageDays).toBe(0);
  });

  it("treats data 1 day old as fresh when from remote", () => {
    const result = computeScheduleFreshness(daysAgo(1), "remote", NOW);
    expect(result.severity).toBe("fresh");
    expect(result.ageDays).toBe(1);
  });

  it("treats data older than the warn threshold as warn", () => {
    const result = computeScheduleFreshness(
      daysAgo(SCHEDULE_WARN_DAYS + 1),
      "remote",
      NOW,
    );
    expect(result.severity).toBe("warn");
  });

  it("treats data older than the stale threshold as stale", () => {
    const result = computeScheduleFreshness(
      daysAgo(SCHEDULE_STALE_DAYS + 1),
      "remote",
      NOW,
    );
    expect(result.severity).toBe("stale");
  });

  it("treats bundled-only data as warn even when its timestamp is fresh", () => {
    const result = computeScheduleFreshness(daysAgo(0), "bundled", NOW);
    expect(result.severity).toBe("warn");
  });

  it("still flags very old bundled data as stale", () => {
    const result = computeScheduleFreshness(
      daysAgo(SCHEDULE_STALE_DAYS + 5),
      "bundled",
      NOW,
    );
    expect(result.severity).toBe("stale");
  });
});
