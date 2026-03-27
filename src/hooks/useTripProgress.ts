import { useGeolocation } from "@/hooks/useGeolocation";
import { useStopInference } from "@/hooks/useStopInference";
import type { StopInferenceResult, ProgressHint } from "@/hooks/useStopInference";
import { useVehiclePositionForTrip } from "@/hooks/useVehiclePositions";
import {
  getDistanceToStationKm,
  haversineKm,
  isSouthbound,
  stationIndexMap,
} from "@/lib/stationUtils";
import { isNearSelectedRoute, selectNextStopTarget } from "@/lib/tripProgress";
import { computeMinutesUntil } from "@/lib/timeUtils";
import { formatDateYYYYMMDD } from "@/lib/timeUtils";
import { stateBg } from "@/lib/tripTheme";
import { TRIP_ENDED_THRESHOLD_MIN } from "@/lib/tripConstants";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripRealtimeStatus, VehiclePositionMatch } from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";

export interface TripProgressResult {
  // Geolocation
  lat: number | null;
  lng: number | null;
  locationLoading: boolean;
  requestLocation: () => void;
  hasReliableGps: boolean;
  inferredOnTrain: boolean;

  // Vehicle position
  vehiclePosition: VehiclePositionMatch | null;
  progressHint: ProgressHint | null;
  activeProgressSource: "vehicle" | "gps" | "schedule";

  // Stop inference (single source of truth)
  stopInference: StopInferenceResult;

  // Derived trip state
  isEnded: boolean;
  minutesAfterArrival: number;
  headerBg: string;

  // Distance
  nextStop: Station | null;
  distanceToNextStopMi: number | null;
  distanceToTrainMi: number | null;

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
  isOpen,
  vehiclePositionOverride,
}: {
  trip: ProcessedTrip;
  fromStation: Station;
  toStation: Station;
  currentTime: Date;
  realtimeStatus?: TripRealtimeStatus | null;
  isNextTrip: boolean;
  /** Whether the sheet is open — gates geolocation watching. */
  isOpen: boolean;
  /** Dev-only: override the live vehicle position hook result. */
  vehiclePositionOverride?: VehiclePositionMatch | null;
}): TripProgressResult {
  // ── Geolocation ───────────────────────────────────────────────────────────
  const {
    lat,
    lng,
    accuracy,
    speedMps,
    timestampMs,
    loading: locationLoading,
    requestLocation,
  } = useGeolocation({
    watch: isOpen,
    autoRequestOnNative: false,
  });

  // ── Trip ended detection ──────────────────────────────────────────────────
  const arrivalTime = realtimeStatus?.liveArrivalTime ?? trip.arrivalTime;
  const minutesAfterArrival = -(computeMinutesUntil(currentTime, arrivalTime));
  const isEnded = minutesAfterArrival > TRIP_ENDED_THRESHOLD_MIN;

  // ── Vehicle position matching ─────────────────────────────────────────────
  const southbound = isSouthbound(fromStation, toStation);
  const originStartTime = southbound
    ? trip.times[0]?.slice(0, 5)
    : trip.times[trip.times.length - 1]?.slice(0, 5);
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

  // ── GPS reliability & on-train inference ──────────────────────────────────
  const gpsAgeMs = timestampMs == null ? Infinity : Date.now() - timestampMs;
  const hasReliableGps =
    lat != null &&
    lng != null &&
    accuracy != null &&
    accuracy <= 65 &&
    gpsAgeMs <= 20_000;

  const nearestOnRoute =
    hasReliableGps && displayStops.length > 0
      ? displayStops.reduce(
          (best, station, index) => {
            const km = getDistanceToStationKm(lat!, lng!, station);
            return km < best.km ? { station, index, km } : best;
          },
          { station: displayStops[0], index: 0, km: Number.POSITIVE_INFINITY },
        )
      : null;

  const routeDistanceKm = nearestOnRoute?.km ?? Number.POSITIVE_INFINITY;
  const isNearRoute = isNearSelectedRoute(routeDistanceKm);

  const inferredOnTrain =
    vehiclePosition == null &&
    hasReliableGps &&
    isNearRoute &&
    speedMps != null &&
    speedMps >= 5.5 &&
    speedMps <= 45;

  const useGpsForProgress =
    vehiclePosition == null &&
    hasReliableGps &&
    (inferredOnTrain || routeDistanceKm <= 0.35);

  // ── Active progress source ────────────────────────────────────────────────
  const activeProgressSource: "vehicle" | "gps" | "schedule" =
    vehiclePosition?.currentStation != null &&
    displayStops.includes(vehiclePosition.currentStation)
      ? "vehicle"
      : useGpsForProgress
        ? "gps"
        : "schedule";

  // ── Header background ─────────────────────────────────────────────────────
  const headerBg = isEnded
    ? "bg-smart-neutral"
    : stateBg[currentAccent === "future" && isNextTrip ? "ontime" : currentAccent];

  // ── Next stop target & distances ──────────────────────────────────────────
  const nextStop =
    lat == null || lng == null
      ? null
      : selectNextStopTarget({
          displayStops,
          currentIndex,
          nearestOnRouteIndex: nearestOnRoute?.index ?? null,
          useGpsForProgress,
        });

  const distanceToNextStopMi =
    nextStop != null && lat != null && lng != null
      ? getDistanceToStationKm(lat, lng, nextStop) * 0.621371
      : null;

  const distanceToTrainMi =
    lat != null && lng != null && vehiclePosition != null
      ? haversineKm(
          lat,
          lng,
          vehiclePosition.position.latitude,
          vehiclePosition.position.longitude,
        ) * 0.621371
      : null;

  // ── Remaining trip stats ──────────────────────────────────────────────────
  const fromIdx = stationIndexMap[fromStation];
  const toIdx = stationIndexMap[toStation];
  const totalStops = Math.abs(toIdx - fromIdx);

  const remainingStops =
    hasStarted && currentIndex >= 0
      ? Math.max(0, displayStops.length - 1 - currentIndex)
      : isEnded
        ? 0
        : null;

  const arrivalMinutes =
    realtimeStatus?.liveArrivalTime ?? trip.arrivalTime;
  const nowMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
  const minutesUntilArrival = hasStarted && !isEnded
    ? Math.max(
        0,
        (() => {
          const cleaned = arrivalMinutes.replace(/[*~]/g, "");
          const [h, m] = cleaned.split(":").map(Number);
          return h * 60 + m - nowMinutes;
        })(),
      )
    : null;

  return {
    lat,
    lng,
    locationLoading,
    requestLocation,
    hasReliableGps,
    inferredOnTrain,
    vehiclePosition,
    progressHint,
    activeProgressSource,
    stopInference,
    isEnded,
    minutesAfterArrival,
    headerBg,
    nextStop,
    distanceToNextStopMi,
    distanceToTrainMi,
    remainingStops,
    minutesUntilArrival,
  };
}
