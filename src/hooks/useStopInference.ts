import { useMemo } from "react";
import {
  getAllStations,
  stationIndexMap,
} from "@/lib/stationUtils";
import { parseTimeToMinutes } from "@/lib/timeUtils";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";

export type StopState = "past" | "current" | "future";
export type StopAccent = "green" | "gold" | "muted" | "destructive" | "default";

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
   * Accent for the current stop — the single source of truth for both the
   * stop-timeline row highlight and the sheet header colour.
   */
  currentAccent: StopAccent;
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
      if (lastPast >= 0) {
        currentIndex = lastPast;
      }
    }

    const states: StopState[] = statusByStop.map((_, i) => {
      if (currentIndex === -1) return "future";
      if (i < currentIndex) return "past";
      if (i === currentIndex) return "current";
      return "future";
    });

    const hasStarted = statusByStop.some((s) => s.isPast);

    const currentStation = currentIndex >= 0 ? displayStops[currentIndex] : null;
    const perStopDelayMin =
      currentStation != null ? (allStopDelayMinutes?.[currentStation] ?? 0) : 0;
    const currentAccent: StopAccent = isCanceled
      ? "destructive"
      : currentIndex === -1
      ? "default"
      : perStopDelayMin > 0
      ? "gold"
      : "green";

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
