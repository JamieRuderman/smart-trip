import { useStopInference } from "@/hooks/useStopInference";
import type { StopInferenceResult, ProgressHint } from "@/hooks/useStopInference";
import { useVehiclePositionForTrip } from "@/hooks/useVehiclePositions";
import { getDistanceToStationKm, isSouthbound } from "@/lib/stationUtils";
import {
  isVehicleShortOfDestination,
  selectNextStopTarget,
  tripOriginStartTime,
} from "@/lib/tripProgress";
import {
  computeMinutesUntil,
  formatDateYYYYMMDD,
  parseTimeToMinutes,
} from "@/lib/timeUtils";
import { stateBg } from "@/lib/tripTheme";
import { TRIP_ENDED_THRESHOLD_MIN } from "@/lib/tripConstants";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripRealtimeStatus, VehiclePositionMatch } from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";

export interface TripProgressResult {
  // Vehicle position
  vehiclePosition: VehiclePositionMatch | null;
  progressHint: ProgressHint | null;
  activeProgressSource: "vehicle" | "schedule";

  // Stop inference (single source of truth)
  stopInference: StopInferenceResult;

  // Derived trip state
  isEnded: boolean;
  minutesAfterArrival: number;
  headerBg: string;

  // Distance
  nextStop: Station | null;
  distanceToNextStopMi: number | null;

  // Remaining trip stats
  remainingStops: number | null;
  minutesUntilArrival: number | null;
}

export function useTripProgress({
  trip,
  fromStation,
  toStation,
  currentTime,
  realtimeStatus,
  isNextTrip,
  isFocused = false,
  vehiclePositionOverride,
}: {
  trip: ProcessedTrip;
  fromStation: Station;
  toStation: Station;
  currentTime: Date;
  realtimeStatus?: TripRealtimeStatus | null;
  isNextTrip: boolean;
  /** When true, this is the user's focused ("Go") / riding trip. The header
   *  band turns blue to match the blue card style, overriding the semantic
   *  state colour (green/gold/red) — blue == "the train I'm taking". */
  isFocused?: boolean;
  /** Dev-only: override the live vehicle position hook result. */
  vehiclePositionOverride?: VehiclePositionMatch | null;
}): TripProgressResult {
  // ── Vehicle position matching ─────────────────────────────────────────────
  const southbound = isSouthbound(fromStation, toStation);
  const originStartTime = tripOriginStartTime(trip.times, southbound);
  const tripDirectionId = southbound ? 0 : 1;
  const todayYYYYMMDD = formatDateYYYYMMDD(currentTime);

  const liveVehiclePosition = useVehiclePositionForTrip(
    originStartTime,
    todayYYYYMMDD,
    tripDirectionId,
  );
  const vehiclePosition =
    vehiclePositionOverride !== undefined
      ? vehiclePositionOverride
      : liveVehiclePosition;

  // ── Trip ended detection ──────────────────────────────────────────────────
  // Time-based: past the (live-aware) arrival plus a short grace. A fresh
  // vehicle-position match that is still short of the destination vetoes the
  // clock — a delayed train whose arrival prediction dropped out of the trip
  // updates feed must not be declared "ended" while the positions feed shows
  // it demonstrably still en route.
  const arrivalTime = realtimeStatus?.liveArrivalTime ?? trip.arrivalTime;
  const minutesAfterArrival = -(computeMinutesUntil(currentTime, arrivalTime));
  const isEnded =
    minutesAfterArrival > TRIP_ENDED_THRESHOLD_MIN &&
    !isVehicleShortOfDestination(vehiclePosition, toStation, southbound);

  const progressHint: ProgressHint | null =
    vehiclePosition?.currentStation != null
      ? {
          source: "vehicle" as const,
          station: vehiclePosition.currentStation,
          status: vehiclePosition.currentStatus,
        }
      : null;

  // ── Stop inference (single call — shared by header + timeline) ────────────
  const stopInference = useStopInference({
    trip,
    fromStation,
    toStation,
    currentTime,
    realtimeStatus,
    progressHint,
  });

  const { currentAccent, hasStarted, displayStops, currentIndex } = stopInference;

  // ── Active progress source ────────────────────────────────────────────────
  // Live train position (GTFS-RT vehicle feed) when available, else schedule.
  const activeProgressSource: "vehicle" | "schedule" =
    vehiclePosition?.currentStation != null &&
    displayStops.includes(vehiclePosition.currentStation)
      ? "vehicle"
      : "schedule";

  // ── Header background ─────────────────────────────────────────────────────
  // Blue == "the train I'm taking" and overrides the semantic state colour
  // (green/gold/red) for the focused / riding trip, matching the blue card.
  const headerBg = isEnded
    ? "bg-smart-neutral"
    : isFocused
      ? "bg-my-trip-background"
      : stateBg[currentAccent === "future" && isNextTrip ? "ontime" : currentAccent];

  // ── Next stop target & distance ───────────────────────────────────────────
  const nextStop = selectNextStopTarget({
    displayStops,
    currentIndex,
    nearestOnRouteIndex: null,
    useGpsForProgress: false,
  });

  // Distance-to-next-stop from the live train position (GTFS-RT vehicle feed).
  const distanceToNextStopMi =
    nextStop != null && vehiclePosition != null
      ? getDistanceToStationKm(
          vehiclePosition.position.latitude,
          vehiclePosition.position.longitude,
          nextStop,
        ) * 0.621371
      : null;

  // ── Remaining trip stats ──────────────────────────────────────────────────
  // currentIndex points to the next upcoming stop (the green highlight),
  // so all stops from currentIndex onward are still ahead of the rider.
  const remainingStops =
    hasStarted && currentIndex >= 0
      ? Math.max(0, displayStops.length - currentIndex)
      : isEnded
        ? 0
        : null;

  const arrivalMinutes =
    realtimeStatus?.liveArrivalTime ?? trip.arrivalTime;
  const nowMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
  const minutesUntilArrival = hasStarted && !isEnded
    ? Math.max(0, parseTimeToMinutes(arrivalMinutes) - nowMinutes)
    : null;

  return {
    vehiclePosition,
    progressHint,
    activeProgressSource,
    stopInference,
    isEnded,
    minutesAfterArrival,
    headerBg,
    nextStop,
    distanceToNextStopMi,
    remainingStops,
    minutesUntilArrival,
  };
}
