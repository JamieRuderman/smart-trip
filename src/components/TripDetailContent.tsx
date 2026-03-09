import { cn } from "@/lib/utils";
import {
  X,
  AlertTriangle,
  AlarmClock,
  Clock,
  MapPin,
  LocateFixed,
  Loader2,
  Navigation2,
} from "lucide-react";
import { parseTimeToMinutes } from "@/lib/timeUtils";
import { calculateTransferTime, isQuickConnection } from "@/lib/timeUtils";
import { FERRY_CONSTANTS } from "@/lib/fareConstants";
import { calculateFare } from "@/lib/scheduleUtils";
import { stationIndexMap } from "@/lib/stationUtils";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { useCountdown } from "@/hooks/useCountdown";
import { useTripStatus } from "@/hooks/useTripStatus";
import { StopTimeline } from "./StopTimeline";
import { FerryConnection } from "./FerryConnection";
import { GutterRow } from "./GutterRow";
import { TimePair } from "./TimePair";
import { CountdownLabel } from "./CountdownLabel";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";
import { Trans, useTranslation } from "react-i18next";
import { TRIP_ENDED_THRESHOLD_MIN } from "@/lib/tripConstants";

export interface TripDetailContentProps {
  trip: ProcessedTrip;
  fromStation: Station;
  toStation: Station;
  currentTime: Date;
  realtimeStatus?: TripRealtimeStatus | null;
  timeFormat: "12h" | "24h";
  isNextTrip: boolean;
  showFerry: boolean;
  onClose: () => void;
  /** Pre-computed by TripDetailSheet so the drag handle and header share one colour. */
  headerBg: string;
  /** Minutes since the train arrived at the destination (positive = past, negative = not yet). */
  minutesAfterArrival: number;
  /** True once at least one stop is in the past (trip has started). */
  hasStarted: boolean;
  /** Next upcoming stop on the route (null when ended or no GPS). */
  nextStop?: Station | null;
  /** Straight-line distance to nextStop in miles (null when no GPS or ended). */
  distanceToNextStopMi?: number | null;
  /** GPS position — lifted to parent so the drag handle colour can incorporate it. */
  lat: number | null;
  lng: number | null;
  locationLoading: boolean;
  requestLocation: () => void;
  showCloseButton?: boolean;
}


export function TripDetailContent({
  trip,
  fromStation,
  toStation,
  currentTime,
  realtimeStatus,
  timeFormat,
  isNextTrip,
  showFerry,
  onClose,
  headerBg,
  minutesAfterArrival,
  hasStarted,
  nextStop = null,
  distanceToNextStopMi = null,
  lat,
  lng,
  locationLoading,
  requestLocation,
  showCloseButton = true,
}: TripDetailContentProps) {
  const { t } = useTranslation();
  const { preferences } = useUserPreferences();

  const { isCanceled, isOriginSkipped, isCanceledOrSkipped, isDelayed, statusLabel } =
    useTripStatus(realtimeStatus, isNextTrip);

  const isEnded = minutesAfterArrival > TRIP_ENDED_THRESHOLD_MIN;

  const departureTime = realtimeStatus?.liveDepartureTime ?? trip.departureTime;
  const arrivalTime = realtimeStatus?.liveArrivalTime ?? trip.arrivalTime;

  const minutesUntil = useCountdown(
    trip.departureTime,
    realtimeStatus?.liveDepartureTime,
    currentTime
  );

  const hasLocation = lat != null && lng != null;

  // Trip metadata
  const tripDurationMinutes =
    parseTimeToMinutes(trip.arrivalTime) - parseTimeToMinutes(trip.departureTime);
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
    isQuickConnection(calculateTransferTime(trip.arrivalTime, trip.outboundFerry.depart));
  const hasInboundQuickConnection =
    trip.inboundFerry &&
    trip.fromStation === FERRY_CONSTANTS.FERRY_STATION &&
    isQuickConnection(calculateTransferTime(trip.inboundFerry.arrive, trip.departureTime));
  const hasQuickConnection = hasOutboundQuickConnection || hasInboundQuickConnection;

  const trainOption = hasInboundQuickConnection
    ? t("quickConnection.laterTrain")
    : t("quickConnection.earlierTrain");

  // Large "Ended X ago" text shown in the countdown row once the trip is done.
  const endedText = isEnded
    ? minutesAfterArrival >= 60
      ? t("tracker.endedHoursMinutesAgo", {
          hours: Math.floor(minutesAfterArrival / 60),
          minutes: minutesAfterArrival % 60,
        })
      : t("tracker.endedMinutesAgo", { minutes: minutesAfterArrival })
    : null;

  // Small header badge — "Ended" for finished trips, realtime label otherwise,
  // "Scheduled" as a fallback for trips that haven't started with no realtime data.
  const headerStatusLabel = isEnded
    ? t("tracker.ended")
    : statusLabel ?? (!hasStarted ? t("tracker.scheduled") : null);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Header band */}
      <div className={cn("flex items-start gap-3 px-4 pt-4 pb-3 shrink-0", headerBg)}>
        {/* Trip number — w-[5rem] aligns with the stop timeline icon gutter */}
        <div className="flex flex-col items-end shrink-0 w-[5rem]">
          <p className="text-xs text-white/80 font-medium mb-0.5">
            {t("tracker.tripLabel")}
          </p>
          <span className="text-4xl font-semibold text-white leading-none">
            {trip.trip}
          </span>
        </div>

        {/* Status label + times */}
        <div className="flex-1 min-w-0">
          {headerStatusLabel && (
            <p className="text-xs text-white/80 mb-0.5 font-medium">{headerStatusLabel}</p>
          )}
          <TimePair
            departure={departureTime}
            arrival={arrivalTime}
            format={timeFormat}
            strikethrough={isCanceledOrSkipped}
            className="text-lg font-semibold text-white"
          />
          {/* Struck-through scheduled times shown only when delayed */}
          {isDelayed && (
            <TimePair
              departure={trip.departureTime}
              arrival={trip.arrivalTime}
              format={timeFormat}
              strikethrough
              className="text-xs mt-0.5 text-white/50"
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

      {/* Countdown / Ended */}
      {!isCanceledOrSkipped && (isEnded || minutesUntil > -30) && (
        <div className="px-4 pt-4 pb-1 shrink-0 flex items-center gap-3">
          <div className="w-[5rem] shrink-0 flex justify-end">
            <AlarmClock className="h-6 w-6 text-muted-foreground/50" aria-hidden="true" />
          </div>
          {isEnded ? (
            <span className="text-2xl font-semibold text-muted-foreground">
              {endedText}
            </span>
          ) : (
            <CountdownLabel minutesUntil={minutesUntil} />
          )}
        </div>
      )}

      {/* Metadata: duration · stops · fare */}
      <div className="px-4 pt-2 pb-3 shrink-0 space-y-0.5">
        <GutterRow className="text-sm text-muted-foreground">
          <span className="flex items-center gap-1 flex-wrap">
            <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{tripDurationLabel}</span>
            {stopCount > 0 && (
              <>
                <span className="mx-1">·</span>
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{t("tracker.stopCount", { count: stopCount })}</span>
              </>
            )}
            {fareInfo && fareInfo.price > 0 && (
              <>
                <span className="mx-1">·</span>
                <span>${fareInfo.price.toFixed(2)}</span>
              </>
            )}
          </span>
        </GutterRow>

        {!isCanceled && (
          <GutterRow className="text-sm text-muted-foreground">
            <span>
              {hasLocation
                ? t("tracker.confidenceHigh")
                : realtimeStatus?.hasRealtimeStopData
                ? t("tracker.confidenceMedium")
                : t("tracker.confidenceLow")}
            </span>
          </GutterRow>
        )}

        {!isEnded && distanceToNextStopMi != null && nextStop != null && (
          <GutterRow className="text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Navigation2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
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
                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden="true" />
              ) : (
                <LocateFixed className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
              <span>{t("header.useMyLocation")}</span>
            </button>
          </GutterRow>
        )}
      </div>

      {/* Scrollable stop timeline */}
      <div
        className="flex-1 overflow-y-auto px-4 pt-1"
        style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
      >
        <StopTimeline
          trip={trip}
          fromStation={fromStation}
          toStation={toStation}
          currentTime={currentTime}
          realtimeStatus={realtimeStatus}
          timeFormat={timeFormat}
          currentLat={lat}
          currentLng={lng}
          isEnded={isEnded}
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
                      components={{ strong: <strong className="text-foreground" /> }}
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
        {trip.inboundFerry && trip.fromStation === FERRY_CONSTANTS.FERRY_STATION && (
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
