import { useMemo } from "react";
import {
  getAllStations,
  stationIndexMap,
} from "@/lib/stationUtils";
import { parseTimeToMinutes } from "@/lib/timeUtils";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";
import type { TripState } from "@/lib/tripTheme";

export type StopState = "past" | "current" | "future";

export interface StopInferenceResult {
  /** Ordered stops in display direction (fromStation → toStation). */
  displayStops: Station[];
  /** Corresponding scheduled (or live) times. */
  displayTimes: string[];
  /** Per-stop metadata (static time, live time, isPast). */
  statusByStop: {
    station: Station;
    staticTime: string;
    liveTime: string | undefined;
    parsed: number;
    isPast: boolean;
  }[];
  /** Display-order state for each stop. */
  states: StopState[];
  /** Index of the inferred current stop. */
  currentIndex: number;
  /** Whether any stops are already past (trip has started). */
  hasStarted: boolean;
  /**
   * Semantic state for the current stop — single source of truth for the
   * stop-timeline row highlight and the sheet header colour.
   */
  currentAccent: TripState;
}

export function useStopInference({
  trip,
  fromStation,
  toStation,
  currentTime,
  realtimeStatus,
}: {
  trip: ProcessedTrip;
  fromStation: Station;
  toStation: Station;
  currentTime: Date;
  realtimeStatus?: TripRealtimeStatus | null;
}): StopInferenceResult {
  const allStations = getAllStations();
  const fromIdx = stationIndexMap[fromStation];
  const toIdx = stationIndexMap[toStation];
  const minIdx = Math.min(fromIdx, toIdx);
  const maxIdx = Math.max(fromIdx, toIdx);
  const isSouthbound = fromIdx < toIdx;

  const stops = allStations.slice(minIdx, maxIdx + 1);
  const times = trip.times.slice(minIdx, maxIdx + 1);
  const displayStops = isSouthbound ? stops : [...stops].reverse();
  const displayTimes = isSouthbound ? times : [...times].reverse();

  const allStopLiveDepartures = realtimeStatus?.allStopLiveDepartures;
  const allStopDelayMinutes = realtimeStatus?.allStopDelayMinutes;
  const isCanceled = realtimeStatus?.isCanceled ?? false;

  const nowMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();

  return useMemo((): StopInferenceResult => {
    const statusByStop = displayStops.map((station, i) => {
      const staticTime = displayTimes[i] ?? "";
      const liveTime = allStopLiveDepartures?.[station];
      const reference = liveTime ?? staticTime;
      const parsed = reference ? parseTimeToMinutes(reference) : Number.NaN;
      const isPast = Number.isFinite(parsed) ? parsed <= nowMinutes : false;
      return { station, staticTime, liveTime, parsed, isPast };
    });

    let currentIndex = -1;

    {
      let lastPast = -1;
      for (let i = 0; i < statusByStop.length; i += 1) {
        if (statusByStop[i].isPast) lastPast = i;
      }
      // Only pin a "current" stop once the trip has actually started (≥1 past stop).
      // Before departure, leave currentIndex at -1 so no stop highlights green.
      // Point to the next upcoming stop (where the train is heading), so the
      // green highlight always shows the stop you're approaching, not the one
      // you just left. At the final stop, keep it on the last stop.
      //
      // Guard: require the origin stop (index 0) to also be in the past before
      // advancing. A stale or incorrect live time on an intermediate stop (e.g.
      // a northbound pass-through time applied to a southbound stop by the
      // GTFS-RT feed) can make that stop appear "past" before the trip has
      // actually departed, incorrectly skipping the origin highlight.
      if (lastPast >= 0 && statusByStop[0]?.isPast) {
        const next = lastPast + 1;
        currentIndex = next < displayStops.length ? next : lastPast;
      }
    }

    const states: StopState[] = statusByStop.map((_, i) => {
      if (currentIndex === -1) return "future";
      if (i < currentIndex) return "past";
      if (i === currentIndex) return "current";
      return "future";
    });

    const hasStarted = statusByStop[0]?.isPast ?? false;

    const currentStation = currentIndex >= 0 ? displayStops[currentIndex] : null;
    const perStopDelayMin =
      currentStation != null ? (allStopDelayMinutes?.[currentStation] ?? 0) : 0;
    const currentAccent: TripState = isCanceled
      ? "canceled"
      : currentIndex === -1
      ? "future"
      : perStopDelayMin > 0
      ? "delayed"
      : "ontime";

    return {
      displayStops,
      displayTimes,
      statusByStop,
      states,
      currentIndex,
      hasStarted,
      currentAccent,
    };
  }, [
    displayStops,
    displayTimes,
    allStopLiveDepartures,
    allStopDelayMinutes,
    nowMinutes,
    isCanceled,
  ]);
}
