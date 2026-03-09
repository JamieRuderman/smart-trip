import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import {
  X,
  AlertTriangle,
  AlarmClock,
  Clock,
  MapPin,
  LocateFixed,
  Loader2,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useGeolocation } from "@/hooks/useGeolocation";
import { parseTimeToMinutes } from "@/lib/timeUtils";
import { calculateTransferTime, isQuickConnection } from "@/lib/timeUtils";
import { FERRY_CONSTANTS } from "@/lib/fareConstants";
import { calculateFare } from "@/lib/scheduleUtils";
import { stationIndexMap } from "@/lib/stationUtils";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { SHEET_EASING, SHEET_TRANSITION_MS } from "@/lib/animationConstants";
import { StopTimeline } from "./StopTimeline";
import { FerryConnection } from "./FerryConnection";
import { GutterRow } from "./GutterRow";
import { TimePair } from "./TimePair";
import { CountdownLabel } from "./CountdownLabel";
import { useTripStatus } from "@/hooks/useTripStatus";
import { useStopInference } from "@/hooks/useStopInference";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";
import { Trans, useTranslation } from "react-i18next";

interface TripDetailSheetProps {
  isOpen: boolean;
  onClose: () => void;
  trip: ProcessedTrip;
  fromStation: Station;
  toStation: Station;
  currentTime: Date;
  realtimeStatus?: TripRealtimeStatus | null;
  timeFormat: "12h" | "24h";
  isNextTrip: boolean;
  showFerry: boolean;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function computeMinutes(
  currentTime: Date,
  staticTime: string,
  liveTime?: string
): number {
  const nowMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
  return parseTimeToMinutes(liveTime ?? staticTime) - nowMinutes;
}

function useCountdown(
  departureTimeStr: string,
  liveDepTime: string | undefined,
  currentTime: Date
) {
  const [minutesUntil, setMinutesUntil] = useState(() =>
    computeMinutes(currentTime, departureTimeStr, liveDepTime)
  );
  useEffect(() => {
    setMinutesUntil(computeMinutes(currentTime, departureTimeStr, liveDepTime));
    const id = setInterval(() => {
      setMinutesUntil(
        computeMinutes(currentTime, departureTimeStr, liveDepTime)
      );
    }, 10000);
    return () => clearInterval(id);
  }, [currentTime, departureTimeStr, liveDepTime]);
  return minutesUntil;
}

// ─── sheet body ──────────────────────────────────────────────────────────────

function SheetContent({
  trip,
  fromStation,
  toStation,
  currentTime,
  realtimeStatus,
  timeFormat,
  isNextTrip,
  showFerry,
  onClose,
  showCloseButton = true,
  trackingEnabled = false,
}: Omit<TripDetailSheetProps, "isOpen"> & {
  showCloseButton?: boolean;
  trackingEnabled?: boolean;
}) {
  const { t } = useTranslation();
  const { preferences } = useUserPreferences();

  const { isCanceled, isOriginSkipped, isCanceledOrSkipped, isDelayed, statusLabel } =
    useTripStatus(realtimeStatus, isNextTrip);

  const departureTime = realtimeStatus?.liveDepartureTime ?? trip.departureTime;
  const arrivalTime = realtimeStatus?.liveArrivalTime ?? trip.arrivalTime;

  const minutesUntil = useCountdown(
    trip.departureTime,
    realtimeStatus?.liveDepartureTime,
    currentTime
  );
  const { lat, lng, loading: locationLoading, requestLocation } = useGeolocation({
    watch: trackingEnabled,
    autoRequestOnNative: false,
  });
  const hasLocation = lat != null && lng != null;

  // Derive header colour from the active stop's accent so the header always
  // matches the highlighted stop row in the timeline below it.
  const { currentAccent, hasStarted } = useStopInference({
    trip, fromStation, toStation, currentTime, realtimeStatus,
    currentLat: lat, currentLng: lng,
  });
  const accentBg = {
    destructive: "bg-destructive",
    gold: "bg-smart-gold",
    // Only colour green when the trip is active or it's the user's next train;
    // future non-next trips stay neutral.
    green: isNextTrip || hasStarted ? "bg-smart-train-green" : "bg-smart-neutral",
    muted: "bg-smart-neutral",
    default: "bg-smart-neutral",
  } as const;
  const headerBg = accentBg[currentAccent];

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

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Header band */}
      <div className={cn("flex items-start gap-3 px-4 pt-4 pb-3 shrink-0", headerBg)}>
        {/* Trip number — w-[5rem] keeps this column aligned with the stop timeline icon gutter */}
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
          {statusLabel && (
            <p className="text-xs text-white/80 mb-0.5 font-medium">{statusLabel}</p>
          )}
          <TimePair
            departure={departureTime}
            arrival={arrivalTime}
            format={timeFormat}
            strikethrough={isCanceledOrSkipped}
            className={cn("text-lg font-semibold", isCanceledOrSkipped ? "text-white" : "text-white")}
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

      {/* Countdown */}
      {!isCanceledOrSkipped && minutesUntil > -30 && (
        <div className="px-4 pt-4 pb-1 shrink-0 flex items-center gap-3">
          <div className="w-[5rem] shrink-0 flex justify-end">
            <AlarmClock className="h-6 w-6 text-muted-foreground/50" aria-hidden="true" />
          </div>
          <CountdownLabel minutesUntil={minutesUntil} />
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

      {/* Quick connection warning */}
      {hasQuickConnection && !isCanceledOrSkipped && (
        <div className="mx-4 mb-3 p-3 rounded-lg bg-smart-gold/10 border border-smart-gold/40 flex items-start gap-2 shrink-0">
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
        />

        {showFerry && trip.outboundFerry && (
          <div className="mt-3 pt-3 border-t border-border">
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

// ─── public export ────────────────────────────────────────────────────────────

export function TripDetailSheet({
  isOpen,
  onClose,
  ...rest
}: TripDetailSheetProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const sheetRef = useRef<HTMLDivElement>(null);

  // headerBg is needed here for the mobile drag handle; useTripStatus is the single source.
  const { headerBg } = useTripStatus(rest.realtimeStatus, rest.isNextTrip);

  // Prevent body scroll when sheet is open on mobile
  useEffect(() => {
    if (!isMobile) return;
    document.body.style.overflow = isOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isOpen, isMobile]);

  // Swipe-to-dismiss
  const touchStartY = useRef<number | null>(null);
  const currentTranslateY = useRef(0);
  const DISMISS_TRANSITION = `transform ${SHEET_TRANSITION_MS}ms ${SHEET_EASING}`;

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    currentTranslateY.current = 0;
    if (sheetRef.current) {
      sheetRef.current.style.transition = "none";
      sheetRef.current.style.transform = "translateY(0)";
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current === null || !sheetRef.current) return;
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta < 0) return;
    currentTranslateY.current = delta;
    sheetRef.current.style.transform = `translateY(${delta}px)`;
  };

  const handleTouchEnd = () => {
    if (!sheetRef.current) return;
    const el = sheetRef.current;
    if (currentTranslateY.current > 100) {
      onClose();
      el.style.transition = DISMISS_TRANSITION;
      el.style.transform = "translateY(110%)";
      setTimeout(() => {
        el.style.transform = "";
        el.style.transition = "";
      }, SHEET_TRANSITION_MS);
    } else {
      el.style.transition = DISMISS_TRANSITION;
      el.style.transform = "translateY(0)";
      setTimeout(() => {
        el.style.transform = "";
        el.style.transition = "";
      }, SHEET_TRANSITION_MS);
    }
    touchStartY.current = null;
    currentTranslateY.current = 0;
  };

  if (!isMobile) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-lg w-[calc(100vw-2rem)] p-0 overflow-hidden max-h-[85vh] flex flex-col [&>button.absolute]:hidden">
          <DialogTitle className="sr-only">
            {t("tracker.tripDetailsAria", { trip: rest.trip.trip })}
          </DialogTitle>
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <SheetContent {...rest} onClose={onClose} showCloseButton trackingEnabled={isOpen} />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Mobile bottom sheet — portalled to body so fixed covers the true full viewport
  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-background/40 dark:bg-background/50 backdrop-blur-[8px] transition-opacity",
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        style={{ transitionDuration: `${SHEET_TRANSITION_MS}ms` }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-label={t("tracker.tripDetailsAria", { trip: rest.trip.trip })}
        aria-modal="true"
        className={cn(
          "fixed inset-x-0 bottom-0 z-50",
          "bg-card rounded-t-2xl overflow-hidden",
          "[box-shadow:0_0_8px_rgba(0,0,0,0.35)]",
          "max-h-[92dvh] flex flex-col",
          "transition-transform",
          isOpen ? "translate-y-0" : "translate-y-full"
        )}
        style={{
          transitionDuration: `${SHEET_TRANSITION_MS}ms`,
          transitionTimingFunction: SHEET_EASING,
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Drag handle — sits on the same status-colour band as the header */}
        <div className={cn("flex justify-center pt-3 pb-1 shrink-0", headerBg)}>
          <div className="w-10 h-1 rounded-full bg-white/40" />
        </div>

        <SheetContent {...rest} onClose={onClose} showCloseButton={false} trackingEnabled={isOpen} />
      </div>
    </>,
    document.body
  );
}
