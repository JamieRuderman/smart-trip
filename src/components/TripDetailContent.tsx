import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  X,
  AlertTriangle,
  Timer,
  Calendar,
  Clock,
  MapPin,
  LocateFixed,
  Loader2,
  ChevronDown,
  ChevronUp,
  Smartphone,
  Train,
} from "lucide-react";
import { parseTimeToMinutes, mpsToMph } from "@/lib/timeUtils";
import { calculateTransferTime, isQuickConnection } from "@/lib/timeUtils";
import { FERRY_CONSTANTS } from "@/lib/fareConstants";
import {
  calculateFare,
  getTodayScheduleType,
  nextServiceDate,
} from "@/lib/scheduleUtils";
import { stationIndexMap, isSouthbound } from "@/lib/stationUtils";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { useCountdown } from "@/hooks/useCountdown";
import { useAlarmStatus } from "@/hooks/useAlarmStatus";
import { useTripStatus } from "@/hooks/useTripStatus";
import { useNow } from "@/hooks/useNow";
import { StopTimeline } from "./StopTimeline";
import { FerryConnection } from "./FerryConnection";
import { GutterRow } from "./GutterRow";
import { TimePair } from "./TimePair";
import { AlarmStatusLabel } from "./AlarmStatusLabel";
import { DepartureReminder } from "./DepartureReminder";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";
import { Trans, useTranslation } from "react-i18next";
import type { TripProgressResult } from "@/hooks/useTripProgress";

export interface TripDetailContentProps {
  trip: ProcessedTrip;
  fromStation: Station;
  toStation: Station;
  currentTime: Date;
  lastUpdated: Date | null;
  realtimeStatus?: TripRealtimeStatus | null;
  timeFormat: "12h" | "24h";
  isNextTrip: boolean;
  showFerry: boolean;
  onClose: () => void;
  /** All trip progress state, computed once in TripDetailSheet. */
  progress: TripProgressResult;
  showCloseButton?: boolean;
  /** User's selected origin/destination — used by StopTimeline to mark
   *  intermediate rows that match the user's chosen leg. */
  userFromStation?: Station | null;
  userToStation?: Station | null;
  /** Open the reminder lead-time picker on mount (home "My Trip" card → "Add
   *  reminder" deep-link). */
  autoOpenReminderPicker?: boolean;
  /** Schedule (weekday/weekend) the displayed trip belongs to — forwarded to
   *  the reminder/focus control so it never has to infer it from today. */
  scheduleType: "weekday" | "weekend";
}


export function TripDetailContent({
  trip,
  fromStation,
  toStation,
  currentTime,
  lastUpdated,
  realtimeStatus,
  timeFormat,
  showFerry,
  onClose,
  progress,
  showCloseButton = true,
  userFromStation = null,
  userToStation = null,
  autoOpenReminderPicker = false,
  scheduleType,
}: TripDetailContentProps) {
  const { t, i18n } = useTranslation();
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const nowSec = useNow(1000, showDebugPanel);
  const { preferences } = useUserPreferences();

  // The displayed trip belongs to a schedule (weekday/weekend) that may not be
  // today's. When it isn't, every "today-relative" readout — the live
  // countdown, distance-to-next-stop, GPS — is meaningless: the train runs on a
  // different day. Show the service day ("Departs Monday") and hide the live
  // tracking instead. (A future calendar-date picker would supersede this.)
  const isOtherDay = scheduleType !== getTodayScheduleType(currentTime);
  const serviceDayLabel = isOtherDay
    ? (() => {
        const [y, mo, d] = nextServiceDate(currentTime, scheduleType)
          .split("-")
          .map(Number);
        return new Date(y, mo - 1, d).toLocaleDateString(i18n.language, {
          weekday: "long",
        });
      })()
    : null;

  const {
    headerBg,
    isEnded,
    minutesAfterArrival,
    nextStop,
    distanceToNextStopMi,
    phoneDistanceToNextStopMi,
    lat,
    lng,
    locationLoading,
    requestLocation,
    hasReliableGps,
    isOnTrain,
    vehiclePosition,
    activeProgressSource,
    distanceToTrainMi,
    stopInference,
    remainingStops,
    minutesUntilArrival,
  } = progress;

  const { hasStarted } = stopInference;

  const { isCanceled, isCanceledOrSkipped, isDelayed, statusLabel } =
    useTripStatus(realtimeStatus);

  const departureTime = realtimeStatus?.liveDepartureTime ?? trip.departureTime;
  const arrivalTime = realtimeStatus?.liveArrivalTime ?? trip.arrivalTime;

  const minutesUntil = useCountdown(
    trip.departureTime,
    realtimeStatus?.liveDepartureTime,
    currentTime,
  );

  const hasLocation = lat != null && lng != null;

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
  const hasInboundQuickConnection =
    trip.inboundFerry &&
    trip.fromStation === FERRY_CONSTANTS.FERRY_STATION &&
    isQuickConnection(
      calculateTransferTime(trip.inboundFerry.arrive, trip.departureTime),
    );
  const hasQuickConnection =
    hasOutboundQuickConnection || hasInboundQuickConnection;

  const trainOption = hasInboundQuickConnection
    ? t("quickConnection.laterTrain")
    : t("quickConnection.earlierTrain");

  // Small header badge — "Ended" for finished trips, realtime label otherwise.
  // Falls back to "Scheduled" before departure or "On time" once en route when
  // no realtime data is available (GPS is tracking, no delay reported).
  const headerStatusLabel = isEnded
    ? t("tracker.ended")
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
    minutesUntilArrival: minutesUntilArrival ?? (
      parseTimeToMinutes(arrivalTime) -
      (currentTime.getHours() * 60 + currentTime.getMinutes())
    ),
    minutesAfterArrival,
    hasStarted,
    isCanceled,
    isCanceledOrSkipped,
    isEnded,
    hasRealtimeStopData: realtimeStatus?.hasRealtimeStopData ?? false,
    hasLiveDepartureTime: realtimeStatus?.liveDepartureTime != null,
    hasReliableGps,
    isOnTrain,
    lastUpdated,
    currentTime,
  });

  // Build the trip stats line: duration, remaining/total stops, fare
  const stopsLabel = remainingStops != null && remainingStops < stopCount
    ? t("tracker.remainingStopCount", { remaining: remainingStops, total: stopCount })
    : t("tracker.stopCount", { count: stopCount });

  // Build the duration label: show remaining time when en route
  const durationDisplay = minutesUntilArrival != null
    ? minutesUntilArrival >= 60
      ? t("tracker.remainingDurationHoursMinutes", {
          hours: Math.floor(minutesUntilArrival / 60),
          minutes: minutesUntilArrival % 60,
        })
      : t("tracker.remainingDurationMinutes", { minutes: minutesUntilArrival })
    : tripDurationLabel;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Header band */}
      <div
        className={cn(
          "flex items-start gap-3 px-4 pt-4 pb-3 shrink-0",
          headerBg,
        )}
      >
        {/* Trip number — w-[5rem] aligns with the stop timeline icon gutter */}
        <div className="flex flex-col items-end shrink-0 w-[5rem] pr-3">
          <p className="text-xs text-white/80 font-medium mb-0.5">
            {t("tracker.tripLabel")}
          </p>
          <span className="text-4xl font-semibold text-white leading-none">
            {trip.trip}
          </span>
        </div>

        {/* Status label + times */}
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              "text-xs text-white/80 mb-0.5 font-medium",
              !headerStatusLabel && "invisible",
            )}
          >
            {headerStatusLabel ?? "\u00a0"}
            <span className="text-white/60"> · </span>
            {directionLabel}
          </p>
          <TimePair
            departure={departureTime}
            arrival={arrivalTime}
            format={timeFormat}
            strikethrough={isCanceledOrSkipped}
            className="text-2xl font-semibold text-white"
          />
          {/* Struck-through scheduled times shown only when delayed */}
          {isDelayed && (
            <TimePair
              departure={trip.departureTime}
              arrival={trip.arrivalTime}
              format={timeFormat}
              className="text-xs mt-0.5 text-white/50"
              strikethrough
            />
          )}
        </div>

        {showCloseButton && (
          <button
            onClick={onClose}
            className="p-2 rounded-full transition-colors shrink-0 hover:bg-white/20"
            aria-label={t("tracker.closeTripDetails")}
          >
            <X className="h-5 w-5 text-white" />
          </button>
        )}
      </div>

      {/*
        All rows below share the same two-column layout as the header:
          col-1: w-[5rem]  icon / number gutter
          col-2: flex-1    text content
          gap:   gap-3
        GutterRow handles this automatically for metadata rows.
      */}

      {/* Countdown / Ended for today's run; the service day for another day. */}
      <div className="px-4 pt-4 pb-1 shrink-0 flex items-center gap-3">
        <div className="w-[5rem] shrink-0 flex justify-end pr-3">
          {isOtherDay ? (
            <Calendar
              className="h-6 w-6 text-muted-foreground"
              aria-hidden="true"
            />
          ) : (
            <Timer
              className="h-6 w-6 text-muted-foreground"
              aria-hidden="true"
            />
          )}
        </div>
        {isOtherDay ? (
          <span className="text-[1.7rem] leading-tight font-semibold tracking-[-0.02em] capitalize">
            {t("focusedTrip.departsOn", { day: serviceDayLabel })}
          </span>
        ) : (
          <AlarmStatusLabel status={alarmStatus} />
        )}
      </div>

      {/* Metadata: duration · stops · fare · [debug toggle] */}
      <div className="px-4 pt-2 pb-3 shrink-0 space-y-0.5">
        <GutterRow className="text-sm text-muted-foreground">
          <span className="flex items-center gap-1 flex-wrap flex-1 min-w-0">
            <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{durationDisplay}</span>
            {stopCount > 0 && (
              <>
                <span className="mx-1">·</span>
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{stopsLabel}</span>
              </>
            )}
            {fareInfo && fareInfo.price > 0 && (
              <>
                <span className="mx-1">·</span>
                <span>${fareInfo.price.toFixed(2)}</span>
              </>
            )}
            {speedMph != null && (
              <>
                <span className="mx-1">·</span>
                <span>{t("tracker.speedMph", { speed: speedMph })}</span>
              </>
            )}
          </span>
          <button
            type="button"
            onClick={() => setShowDebugPanel((v) => !v)}
            aria-expanded={showDebugPanel}
            aria-label={
              showDebugPanel
                ? "Hide data sources"
                : "Show data sources"
            }
            className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
          >
            {showDebugPanel ? (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </GutterRow>

        {!isOtherDay && !isEnded && distanceToNextStopMi != null && nextStop != null && (
          <GutterRow className="text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <LocateFixed
                className="h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
              <span>
                {distanceToNextStopMi < 0.05
                  ? t("tracker.atStop", { stop: nextStop })
                  : t("tracker.distanceMiToStop", {
                      distance: distanceToNextStopMi.toFixed(1),
                      stop: nextStop,
                    })}
              </span>
            </span>
          </GutterRow>
        )}

        {!isOtherDay && !hasLocation && (
          <GutterRow>
            <button
              onClick={requestLocation}
              disabled={locationLoading}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              aria-label={t("header.useMyLocation")}
            >
              {locationLoading ? (
                <Loader2
                  className="h-3.5 w-3.5 animate-spin shrink-0"
                  aria-hidden="true"
                />
              ) : (
                <LocateFixed
                  className="h-3.5 w-3.5 shrink-0"
                  aria-hidden="true"
                />
              )}
              <span>{t("header.useMyLocation")}</span>
            </button>
          </GutterRow>
        )}

        {/* Data Sources panel (toggled by the chevron in the metadata row) */}
        {showDebugPanel && (
          <GutterRow className="pt-1">
            <div className="flex-1 rounded-md border border-border/60 divide-y divide-border/40 text-xs overflow-hidden">
              {/* Schedule inference row */}
              <div className="flex items-start gap-2 px-3 py-2">
                <span
                  className={cn(
                    "mt-1 h-1.5 w-1.5 rounded-full shrink-0",
                    activeProgressSource === "schedule"
                      ? "bg-green-500"
                      : "bg-muted-foreground/30",
                  )}
                />
                <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground/80">Schedule</p>
                  <p className="text-muted-foreground">
                    {hasStarted
                      ? `Current: ${nextStop ?? "—"}`
                      : "Not yet departed"}
                  </p>
                </div>
              </div>

              {/* Train GPS (vehicle positions) row */}
              <div className="flex items-start gap-2 px-3 py-2">
                <span
                  className={cn(
                    "mt-1 h-1.5 w-1.5 rounded-full shrink-0",
                    activeProgressSource === "vehicle"
                      ? "bg-green-500"
                      : "bg-muted-foreground/30",
                  )}
                />
                <Train className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground/80">Train GPS</p>
                  {vehiclePosition ? (
                    <p className="text-muted-foreground">
                      {vehiclePosition.currentStatus === "STOPPED_AT"
                        ? "Stopped at"
                        : "In transit to"}{" "}
                      {vehiclePosition.currentStation ??
                        `stop #${vehiclePosition.currentStopSequence}`}
                      {vehiclePosition.position.speed != null && (
                        <>
                          {" "}
                          · {mpsToMph(vehiclePosition.position.speed)} mph
                        </>
                      )}
                      {distanceToTrainMi != null && (
                        <> · {distanceToTrainMi.toFixed(1)} mi from phone</>
                      )}
                      {" · "}age{" "}
                      {nowSec - Math.floor(vehiclePosition.timestamp)}s
                    </p>
                  ) : (
                    <p className="text-muted-foreground">No match</p>
                  )}
                </div>
              </div>

              {/* Phone GPS row */}
              <div className="flex items-start gap-2 px-3 py-2">
                <span
                  className={cn(
                    "mt-1 h-1.5 w-1.5 rounded-full shrink-0",
                    activeProgressSource === "gps"
                      ? "bg-green-500"
                      : "bg-muted-foreground/30",
                  )}
                />
                <Smartphone className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground/80">Phone GPS</p>
                  {hasReliableGps ? (
                    <p className="text-muted-foreground">
                      {nextStop ? `Nearest: ${nextStop}` : "—"}
                      {phoneDistanceToNextStopMi != null && (
                        <> · {phoneDistanceToNextStopMi.toFixed(1)} mi</>
                      )}
                      {isOnTrain && <> · on train</>}
                    </p>
                  ) : (
                    <p className="text-muted-foreground">
                      {lat != null ? "Low accuracy / stale" : "No location"}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </GutterRow>
        )}
      </div>

      {/* Departure reminder — own section so it reads as an action area
          rather than just another row of trip metadata. */}
      {!isEnded && !isCanceledOrSkipped && (
        <div className="px-4 pb-2 shrink-0">
          <DepartureReminder
            tripNumber={trip.trip}
            fromStation={fromStation}
            toStation={toStation}
            departureTime={trip.departureTime}
            liveDepartureTime={realtimeStatus?.liveDepartureTime ?? null}
            arrivalTime={trip.arrivalTime}
            realtimeArrivalTime={realtimeStatus?.liveArrivalTime ?? null}
            currentTime={currentTime}
            timeFormat={timeFormat}
            scheduleType={scheduleType}
            autoOpenPicker={autoOpenReminderPicker}
          />
        </div>
      )}

      {/* Scrollable stop timeline. AppSheet pads its container for the
          Android nav bar / iOS home indicator, so this just needs a normal
          bottom gap. */}
      <div
        data-sheet-scroll-area="true"
        className="flex-1 overflow-y-auto overscroll-contain px-4 pt-1 pb-6"
      >
        <StopTimeline
          trip={trip}
          fromStation={fromStation}
          toStation={toStation}
          realtimeStatus={realtimeStatus}
          timeFormat={timeFormat}
          isEnded={isEnded}
          stopInference={stopInference}
          userFromStation={userFromStation}
          userToStation={userToStation}
        />

        {showFerry && trip.outboundFerry && (
          <div className="mt-3 pt-3 border-t border-border">
            {/* Quick connection warning — sits between the divider and ferry times */}
            {hasQuickConnection && !isCanceledOrSkipped && (
              <div className="mb-3 p-3 rounded-lg bg-smart-gold/10 border border-smart-gold/40 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-smart-gold mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-smart-gold">
                    {t("quickConnection.quickTransferWarning")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    <Trans
                      i18nKey="quickConnection.message"
                      values={{ trainOption }}
                      components={{
                        strong: <strong className="text-foreground" />,
                      }}
                    />
                  </p>
                </div>
              </div>
            )}
            <FerryConnection
              ferry={trip.outboundFerry}
              trainArrivalTime={arrivalTime}
              timeFormat={timeFormat}
            />
          </div>
        )}
        {trip.inboundFerry &&
          trip.fromStation === FERRY_CONSTANTS.FERRY_STATION && (
            <div className="mt-3 pt-3 border-t border-border">
              <FerryConnection
                ferry={trip.inboundFerry}
                trainDepartureTime={departureTime}
                timeFormat={timeFormat}
                inbound
              />
            </div>
          )}
      </div>
    </div>
  );
}
