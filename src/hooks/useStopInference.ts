import { useMemo } from "react";
import {
  getAllStations,
  stationIndexMap,
  isSouthbound as isSouthboundFn,
} from "@/lib/stationUtils";
import { parseTimeToMinutes } from "@/lib/timeUtils";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";
import type { TripState } from "@/lib/tripTheme";

export type StopState = "past" | "current" | "future";

/**
 * Source-aware hint about the train's current position.
 * Provided by TripDetailSheet after resolving the best available data source.
 *
 * - "vehicle": from the GTFS-RT vehiclepositions feed (authoritative for progress)
 * - "gps": from the user's phone GPS (fallback when no vehicle match)
 *
 * useStopInference uses this as a higher-priority override over time-based inference,
 * subject to a sanity check that the station is within the displayed stop range.
 */
export interface ProgressHint {
  source: "vehicle" | "gps";
  station: Station;
  status?: "STOPPED_AT" | "IN_TRANSIT_TO" | "INCOMING_AT";
}

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
  progressHint,
}: {
  trip: ProcessedTrip;
  fromStation: Station;
  toStation: Station;
  currentTime: Date;
  realtimeStatus?: TripRealtimeStatus | null;
  /**
   * Optional hint from an external source (vehicle position or phone GPS) about
   * the train's current position. When valid, this overrides time-based inference.
   * A sanity check ensures the station is within the displayed stop range.
   */
  progressHint?: ProgressHint | null;
}): StopInferenceResult {
  const allStations = getAllStations();
  const fromIdx = stationIndexMap[fromStation];
  const toIdx = stationIndexMap[toStation];
  const minIdx = Math.min(fromIdx, toIdx);
  const maxIdx = Math.max(fromIdx, toIdx);
  const southbound = isSouthboundFn(fromStation, toStation);

  const stops = allStations.slice(minIdx, maxIdx + 1);
  const times = trip.times.slice(minIdx, maxIdx + 1);
  const displayStops = southbound ? stops : [...stops].reverse();
  const displayTimes = southbound ? times : [...times].reverse();

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

    // ── ProgressHint: highest-priority override for current stop ─────────────
    // When a vehicle position or GPS hint is available, use it to determine which
    // stop is current, bypassing time-based inference. Requires a sanity check
    // that the hinted station is within the user's from-to stop range.
    if (progressHint != null) {
      const hintIdx = displayStops.indexOf(progressHint.station);
      if (hintIdx !== -1) {
        // Station is within the displayed range — use the hint.
        // For STOPPED_AT: train is at the station. For IN_TRANSIT_TO / INCOMING_AT:
        // the train is heading toward that stop (it's the "next" stop in our semantics).
        currentIndex = hintIdx;
      }
      // If hintIdx === -1, the vehicle's station is outside the from-to segment;
      // fall through to time-based inference below.
    }

    // ── Time-based inference (fallback when no valid hint) ───────────────────
    if (currentIndex === -1) {
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

    const states: StopState[] = Array.from({ length: statusByStop.length }, () => "future");
    for (let i = 0; i < states.length; i += 1) {
      if (currentIndex === -1) continue;
      if (i < currentIndex) states[i] = "past";
      else if (i === currentIndex) states[i] = "current";
    }

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
    progressHint,
  ]);
}
