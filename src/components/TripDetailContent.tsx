import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  X,
  AlertTriangle,
  Timer,
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
import { calculateFare } from "@/lib/scheduleUtils";
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
}: TripDetailContentProps) {
  const { t } = useTranslation();
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const nowSec = useNow(1000, showDebugPanel);
  const { preferences } = useUserPreferences();

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

      {/* Countdown / Ended — always shown */}
      <div className="px-4 pt-4 pb-1 shrink-0 flex items-center gap-3">
        <div className="w-[5rem] shrink-0 flex justify-end pr-3">
          <Timer className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <AlarmStatusLabel status={alarmStatus} />
      </div>

      {/* Metadata: duration · stops · fare */}
      <div className="px-4 pt-2 pb-3 shrink-0 space-y-0.5">
        <GutterRow className="text-sm text-muted-foreground">
          <span className="flex items-center gap-1 flex-wrap">
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
        </GutterRow>

        {!isEnded && distanceToNextStopMi != null && nextStop != null && (
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

        {!hasLocation && (
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
      </div>

      {/* ── Debug: Data Sources panel (dev/QA only, collapsed by default) ── */}
      <div className="px-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-[5rem] shrink-0" aria-hidden="true" />
          <button
            onClick={() => setShowDebugPanel((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-muted-foreground/70 transition-colors py-1"
            aria-expanded={showDebugPanel}
          >
            {showDebugPanel ? (
              <ChevronUp className="h-3 w-3 shrink-0" />
            ) : (
              <ChevronDown className="h-3 w-3 shrink-0" />
            )}
            Data sources
          </button>
        </div>

        {showDebugPanel && (
          <div className="flex gap-3">
            <div className="w-[5rem] shrink-0" aria-hidden="true" />
            <div className="mb-2 rounded-md border border-border/60 divide-y divide-border/40 text-xs overflow-hidden flex-1">
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
          </div>
        )}
      </div>

      {/* Scrollable stop timeline */}
      <div
        data-sheet-scroll-area="true"
        className="flex-1 overflow-y-auto overscroll-contain px-4 pt-1"
        style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
      >
        <StopTimeline
          trip={trip}
          fromStation={fromStation}
          toStation={toStation}
          realtimeStatus={realtimeStatus}
          timeFormat={timeFormat}
          isEnded={isEnded}
          stopInference={stopInference}
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
