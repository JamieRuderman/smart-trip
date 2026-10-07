import { useTranslation } from "react-i18next";
import {
  calculateTransferTime,
  isQuickConnection,
  minutesOfDay,
  mpsToMph,
  parseTimeToMinutes,
} from "@/lib/timeUtils";
import { FERRY_CONSTANTS } from "@/lib/fareConstants";
import { calculateFare } from "@/lib/scheduleUtils";
import { stationIndexMap, isSouthbound } from "@/lib/stationUtils";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { useStationSelection } from "@/contexts/stationSelection";
import { useCountdown } from "@/hooks/useCountdown";
import { useAlarmStatus } from "@/hooks/useAlarmStatus";
import { useTripStatus } from "@/hooks/useTripStatus";
import type { AlarmStatusSelection } from "@/lib/alarmStatus";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";
import type { TripProgressResult } from "@/hooks/useTripProgress";

export interface TripDetailModelInput {
  trip: ProcessedTrip;
  fromStation: Station;
  toStation: Station;
  currentTime: Date;
  lastUpdated: Date | null;
  realtimeStatus?: TripRealtimeStatus | null;
  showFerry: boolean;
  /** All trip progress state, computed once by the caller. */
  progress: TripProgressResult;
  /** The displayed trip is the user's focused trip — its armed leave reminder
   *  (if any) leads the status with a "leave in" countdown. */
  isFocused: boolean;
}

export interface TripDetailModel {
  isCanceledOrSkipped: boolean;
  isDelayed: boolean;
  /** Live-aware departure/arrival "HH:MM". */
  departureTime: string;
  arrivalTime: string;
  /** Minutes until (live-aware) departure; negative once departed. */
  minutesUntil: number;
  /** "On time" / "Delayed N min" / "Ended" / … for the header band. */
  headerStatusLabel: string | null;
  directionLabel: string;
  tripDurationLabel: string;
  fareInfo: ReturnType<typeof calculateFare> | null;
  stopCount: number;
  stopsLabel: string;
  /** Live speed while the matched vehicle is moving, else null. */
  speedMph: number | null;
  hasQuickConnection: boolean;
  /** "earlier"/"later train" wording for the quick-connection warning. */
  trainOption: string;
  /** The trip starts at the ferry terminal with an inbound ferry to show. */
  showInboundFerry: boolean;
  alarmStatus: AlarmStatusSelection;
  /** The rider has reached their destination — "approaching" cues stop. */
  isAtDestination: boolean;
}

/**
 * Everything a trip-detail surface derives from a trip + its live status +
 * progress: live times, status labels, the headline alarm status, and trip
 * metadata. Shared by the detail sheet ({@link TripDetailContent}) and the
 * full-page My Trip view so both always tell the same story.
 */
export function useTripDetailModel({
  trip,
  fromStation,
  toStation,
  currentTime,
  lastUpdated,
  realtimeStatus,
  showFerry,
  progress,
  isFocused,
}: TripDetailModelInput): TripDetailModel {
  const { t } = useTranslation();
  const { preferences } = useUserPreferences();

  const {
    isEnded,
    minutesAfterArrival,
    vehiclePosition,
    stopInference,
    remainingStops,
    minutesUntilArrival,
  } = progress;
  const { hasStarted, displayStops, currentIndex } = stopInference;

  // The live vehicle position vetoes a premature "At destination": if the train
  // is still in transit to the rider's destination (or sitting at an earlier
  // stop), it hasn't arrived — even once the scheduled arrival minute has passed
  // on a running-late train. "Arrived" is only the vehicle STOPPED_AT the final
  // stop, or gone from the leg entirely (a through train that pulled away).
  const vehicleStopIndex =
    vehiclePosition?.currentStation != null
      ? displayStops.indexOf(vehiclePosition.currentStation)
      : -1;
  const stillApproachingDestination =
    vehiclePosition != null &&
    vehicleStopIndex !== -1 &&
    !(
      vehicleStopIndex === displayStops.length - 1 &&
      vehiclePosition.currentStatus === "STOPPED_AT"
    );

  const { isCanceled, isCanceledOrSkipped, isDelayed, statusLabel } =
    useTripStatus(realtimeStatus);

  const departureTime = realtimeStatus?.liveDepartureTime ?? trip.departureTime;
  const arrivalTime = realtimeStatus?.liveArrivalTime ?? trip.arrivalTime;

  const minutesUntil = useCountdown(
    trip.departureTime,
    realtimeStatus?.liveDepartureTime,
    currentTime,
  );

  // When this is the user's focused trip and a leave reminder is armed, lead
  // with the "leave in" countdown (reminder fires `leadMinutes` before
  // departure, so it tracks the same clock as the departure countdown). Other
  // trips never carry a reminder, so they skip the leave stage.
  const { focusedTrip } = useStationSelection();
  const reminderLeadMinutes =
    isFocused && focusedTrip?.reminder != null
      ? focusedTrip.reminder.leadMinutes
      : null;
  const minutesUntilLeave =
    reminderLeadMinutes != null ? minutesUntil - reminderLeadMinutes : null;

  // Trip metadata
  const tripDurationMinutes =
    parseTimeToMinutes(trip.arrivalTime) -
    parseTimeToMinutes(trip.departureTime);
  const tripDurationLabel =
    tripDurationMinutes >= 60
      ? t("tracker.durationHoursMinutes", {
          hours: Math.floor(tripDurationMinutes / 60),
          minutes: tripDurationMinutes % 60,
        })
      : t("tracker.durationMinutes", { minutes: tripDurationMinutes });

  const fareInfo =
    preferences.selectedFareType !== "none"
      ? calculateFare(fromStation, toStation, preferences.selectedFareType)
      : null;

  const fromIdx = stationIndexMap[fromStation];
  const toIdx = stationIndexMap[toStation];
  const stopCount = Math.abs(toIdx - fromIdx);

  const hasOutboundQuickConnection =
    showFerry &&
    trip.outboundFerry &&
    isQuickConnection(
      calculateTransferTime(trip.arrivalTime, trip.outboundFerry.depart),
    );
  const showInboundFerry =
    trip.inboundFerry != null &&
    trip.fromStation === FERRY_CONSTANTS.FERRY_STATION;
  const hasInboundQuickConnection =
    showInboundFerry &&
    trip.inboundFerry != null &&
    isQuickConnection(
      calculateTransferTime(trip.inboundFerry.arrive, trip.departureTime),
    );
  const hasQuickConnection = Boolean(
    hasOutboundQuickConnection || hasInboundQuickConnection,
  );

  const trainOption = hasInboundQuickConnection
    ? t("quickConnection.laterTrain")
    : t("quickConnection.earlierTrain");

  // Delay at the stop the train is currently approaching — the SAME signal
  // the map marker paints orange from. The endpoint-based statusLabel misses
  // an en-route slip once the displayed leg's origin has been served and
  // pruned from the feed, which read "On time" here while the marker showed
  // the train delayed. (allStopDelayMinutes only carries entries at/above the
  // shared threshold, so presence == delayed.)
  const currentStopDelayMin =
    currentIndex >= 0
      ? (realtimeStatus?.allStopDelayMinutes?.[displayStops[currentIndex]] ?? 0)
      : 0;

  // Small header badge — "Ended" for finished trips, realtime label otherwise.
  // Falls back to "Scheduled" before departure or "On time" once en route when
  // no realtime data is available (GPS is tracking, no delay reported).
  const headerStatusLabel = isEnded
    ? t("tracker.ended")
    : !isCanceledOrSkipped && !isDelayed && currentStopDelayMin > 0
      ? t("tripCard.delayed", { minutes: currentStopDelayMin })
      : statusLabel ??
        (hasStarted ? t("tripCard.onTime") : t("tracker.scheduled"));

  const directionLabel = isSouthbound(fromStation, toStation)
    ? t("tracker.southbound")
    : t("tracker.northbound");

  // Live speed from the matched vehicle (m/s → mph). Only shown while a
  // vehicle is actively reporting and moving.
  const speedMph =
    vehiclePosition?.position?.speed != null &&
    vehiclePosition.position.speed > 0
      ? mpsToMph(vehiclePosition.position.speed)
      : null;

  const alarmStatus = useAlarmStatus({
    tripId: trip.trip,
    minutesUntilDeparture: minutesUntil,
    minutesUntilArrival:
      minutesUntilArrival ??
      parseTimeToMinutes(arrivalTime) - minutesOfDay(currentTime),
    minutesAfterArrival,
    minutesUntilLeave,
    hasStarted,
    isCanceled,
    isCanceledOrSkipped,
    isEnded,
    hasRealtimeStopData: realtimeStatus?.hasRealtimeStopData ?? false,
    hasLiveDepartureTime: realtimeStatus?.liveDepartureTime != null,
    // A matched vehicle position is already staleness-filtered by
    // useVehiclePositionForTrip, so its presence means live train tracking —
    // enough to show a live arrival countdown instead of "On the way". (The
    // dev-only vehiclePositionOverride deliberately counts, to simulate it.)
    hasLivePosition: vehiclePosition != null,
    stillApproachingDestination,
    lastUpdated,
    currentTime,
  });

  // Build the trip stats line: duration, remaining/total stops, fare
  const stopsLabel = remainingStops != null && remainingStops < stopCount
    ? t("tracker.remainingStopCount", { remaining: remainingStops, total: stopCount })
    : t("tracker.stopCount", { count: stopCount });

  // Once the rider has reached their destination the "approaching" cues stop
  // making sense: the distance-to-stop grows as a through train pulls away, and
  // the final stop shouldn't stay highlighted as the current stop.
  const isAtDestination = alarmStatus.phase === "AT_DESTINATION";

  return {
    isCanceledOrSkipped,
    isDelayed,
    departureTime,
    arrivalTime,
    minutesUntil,
    headerStatusLabel,
    directionLabel,
    tripDurationLabel,
    fareInfo,
    stopCount,
    stopsLabel,
    speedMph,
    hasQuickConnection,
    trainOption,
    showInboundFerry,
    alarmStatus,
    isAtDestination,
  };
}
