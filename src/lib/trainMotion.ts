/**
 * Schedule-driven train motion for the line diagram.
 *
 * A train's position between GTFS-RT fixes should advance at timetable rate,
 * not at a flat lerp. If Petaluma North → Downtown takes 3 min, the dot
 * should be halfway there 90 seconds into the segment.
 *
 * Caller ticks `now` forward and we interpolate within the station pair
 * that brackets it, offset by the train's reported `delayMinutes`.
 */

import type { MapTrain } from "@/hooks/useMapTrains";
import {
  findFullCorridorTrip,
  getScheduleVersion,
  type ProcessedTrip,
} from "@/lib/scheduleUtils";
import { minutesOfDay, parseTimeToMinutes } from "@/lib/timeUtils";
import stations from "@/data/stations";

export interface ScheduledMotion {
  progress: number;
  direction: "S" | "N";
}

// Precomputed station-index walks. Southbound = north→south (index ascending),
// northbound = south→north (descending). Reused across every tick/train.
const ORDER_SB: readonly number[] = [...stations.keys()];
const ORDER_NB: readonly number[] = [...ORDER_SB].reverse();

// `findFullCorridorTrip` rescans the schedule cache; with N trains ticking
// every second this blows up. Cache by (direction, startTime, tripNumber),
// invalidating whenever the schedule payload is rebuilt.
let tripCacheVersion = -1;
const tripLookupCache = new Map<string, ProcessedTrip | null>();

function lookupTrip(
  directionId: number,
  startTime: string,
  tripNumber: number | null,
): ProcessedTrip | null {
  const v = getScheduleVersion();
  if (v !== tripCacheVersion) {
    tripLookupCache.clear();
    tripCacheVersion = v;
  }
  const key = `${directionId}|${startTime}|${tripNumber ?? ""}`;
  const hit = tripLookupCache.get(key);
  if (hit !== undefined) return hit;
  const trip = findFullCorridorTrip(
    directionId,
    startTime,
    tripNumber ?? undefined,
  );
  tripLookupCache.set(key, trip);
  return trip;
}

// Per-trip scheduled minute-of-day array. Keyed on object identity — on a
// schedule rebuild the old ProcessedTrip references are discarded and GC'd,
// so stale entries drop out naturally.
const schedMinutesCache = new WeakMap<ProcessedTrip, Array<number | null>>();

function schedMinutesFor(trip: ProcessedTrip): Array<number | null> {
  const hit = schedMinutesCache.get(trip);
  if (hit) return hit;
  const arr = trip.times.map((t) =>
    !t || t === "~~" ? null : parseTimeToMinutes(t),
  );
  schedMinutesCache.set(trip, arr);
  return arr;
}

/**
 * Compute a train's progress along its schedule at wall time `now`.
 * Returns null when the train can't be matched to a static trip.
 */
export function scheduledProgress(
  train: MapTrain,
  now: Date,
): ScheduledMotion | null {
  if (
    train.tripNumber == null ||
    train.directionId == null ||
    train.startTime == null
  ) {
    return null;
  }

  const trip = lookupTrip(train.directionId, train.startTime, train.tripNumber);
  if (!trip) return null;

  const direction: "S" | "N" = train.directionId === 1 ? "N" : "S";
  const base = schedMinutesFor(trip);
  const delay = train.delayMinutes ?? 0;
  const nowMinutes = minutesOfDay(now);
  const order = direction === "S" ? ORDER_SB : ORDER_NB;

  let prevIdx: number | null = null;
  for (const idx of order) {
    const baseT = base[idx];
    if (baseT == null) continue;
    const t = baseT + delay;
    if (nowMinutes < t) {
      if (prevIdx == null) return { progress: idx, direction };
      const prevT = base[prevIdx]! + delay;
      const span = t - prevT;
      if (span <= 0) return { progress: idx, direction };
      const frac = (nowMinutes - prevT) / span;
      return { progress: prevIdx + (idx - prevIdx) * frac, direction };
    }
    prevIdx = idx;
  }
  return prevIdx != null ? { progress: prevIdx, direction } : null;
}
