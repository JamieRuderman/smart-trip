import { useEffect, useState } from "react";

import { useScheduleData, type ScheduleSource } from "@/hooks/useScheduleData";

export type FreshnessSeverity = "fresh" | "warn" | "stale";

/** Schedule age (in days) at which the UI starts hinting "data may be old". */
export const SCHEDULE_WARN_DAYS = 7;
/** Schedule age (in days) at which the UI shows a hard "data is stale" warning. */
export const SCHEDULE_STALE_DAYS = 30;

export interface ScheduleFreshness {
  generatedAt: Date | null;
  source: ScheduleSource;
  /** Whole days between `generatedAt` and `now`. `null` when no timestamp. */
  ageDays: number | null;
  severity: FreshnessSeverity;
}

/**
 * Pure helper that grades schedule freshness. Bundled-only data is treated as
 * "warn" regardless of age, since it implies the runtime fetch never landed —
 * if the deployed schedules.json is also stale, the user should still know.
 */
export function computeScheduleFreshness(
  generatedAt: Date | null,
  source: ScheduleSource,
  now: Date = new Date(),
): ScheduleFreshness {
  if (!generatedAt) {
    return { generatedAt, source, ageDays: null, severity: "warn" };
  }
  const ageDays = Math.floor(
    (now.getTime() - generatedAt.getTime()) / 86_400_000,
  );
  let severity: FreshnessSeverity;
  if (ageDays > SCHEDULE_STALE_DAYS) {
    severity = "stale";
  } else if (ageDays > SCHEDULE_WARN_DAYS || source === "bundled") {
    severity = "warn";
  } else {
    severity = "fresh";
  }
  return { generatedAt, source, ageDays, severity };
}

/**
 * Live freshness state for the schedule data shown to the user. Recomputes
 * once an hour so a long-open session crosses the warn/stale thresholds
 * without needing a full refresh.
 */
export function useScheduleFreshness(): ScheduleFreshness {
  const { source, generatedAt } = useScheduleData();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, []);

  return computeScheduleFreshness(generatedAt, source, now);
}
