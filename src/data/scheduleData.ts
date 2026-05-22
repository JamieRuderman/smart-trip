import { trainSchedules, type ScheduleType } from "@/data/trainSchedules";
import {
  weekdayFerries,
  weekendFerries,
  weekdayInboundFerries,
  weekendInboundFerries,
} from "@/data/ferrySchedule";
import scheduleOverrides from "@/data/scheduleOverrides";
import type { FerryConnection, TrainSchedule } from "@/types/smartSchedule";

export type FerrySchedules = {
  weekdayFerries: FerryConnection[];
  weekendFerries: FerryConnection[];
  weekdayInboundFerries: FerryConnection[];
  weekendInboundFerries: FerryConnection[];
};

/**
 * "YYYY-MM-DD" → schedule type that actually runs that day, when it differs
 * from the natural day-of-week (e.g. Memorial Day Monday → "weekend").
 * Derived from GTFS `calendar_dates.txt` at build time.
 */
export type ScheduleOverrides = Record<string, ScheduleType>;

export type SchedulePayload = {
  trainSchedules: Record<ScheduleType, TrainSchedule>;
  ferrySchedules: FerrySchedules;
  scheduleOverrides?: ScheduleOverrides;
  generatedAt?: string;
};

export const bundledSchedulePayload: SchedulePayload = {
  trainSchedules,
  ferrySchedules: {
    weekdayFerries,
    weekendFerries,
    weekdayInboundFerries,
    weekendInboundFerries,
  },
  scheduleOverrides,
};

function isValidScheduleOverrides(value: unknown): value is ScheduleOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (v !== "weekday" && v !== "weekend") return false;
  }
  return true;
}

export function isSchedulePayload(value: unknown): value is SchedulePayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as SchedulePayload;
  const train = payload.trainSchedules;
  const ferry = payload.ferrySchedules;
  const baseValid = Boolean(
    train &&
      train.weekday &&
      train.weekend &&
      ferry &&
      Array.isArray(ferry.weekdayFerries) &&
      Array.isArray(ferry.weekendFerries) &&
      Array.isArray(ferry.weekdayInboundFerries) &&
      Array.isArray(ferry.weekendInboundFerries)
  );
  if (!baseValid) return false;
  // Overrides are optional, but if present every value must be a valid type.
  if (
    payload.scheduleOverrides !== undefined &&
    !isValidScheduleOverrides(payload.scheduleOverrides)
  ) {
    return false;
  }
  return true;
}
