import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { X, AlertTriangle, Clock, DollarSign, MapPin } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useGeolocation } from "@/hooks/useGeolocation";
import { parseTimeToMinutes } from "@/lib/timeUtils";
import { calculateTransferTime, isQuickConnection } from "@/lib/timeUtils";
import { FERRY_CONSTANTS, FARE_CONSTANTS } from "@/lib/fareConstants";
import { calculateZonesBetweenStations, stationIndexMap } from "@/lib/stationUtils";
import { SHEET_EASING, SHEET_TRANSITION_MS } from "@/lib/animationConstants";
import { TrainBadge } from "./TrainBadge";
import { TimeDisplay } from "./TimeDisplay";
import { TripStatusPills } from "./TripStatusPills";
import { StopTimeline } from "./StopTimeline";
import { FerryConnection } from "./FerryConnection";
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
      setMinutesUntil(computeMinutes(currentTime, departureTimeStr, liveDepTime));
    }, 10000);
    return () => clearInterval(id);
  }, [currentTime, departureTimeStr, liveDepTime]);

  useEffect(() => {
    setMinutesUntil(computeMinutes(currentTime, departureTimeStr, liveDepTime));
  }, [currentTime, departureTimeStr, liveDepTime]);

  return minutesUntil;
}

function computeMinutes(
  currentTime: Date,
  staticTime: string,
  liveTime?: string
): number {
  const nowMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
  const depMinutes = parseTimeToMinutes(liveTime ?? staticTime);
  return depMinutes - nowMinutes;
}

function CountdownDisplay({ minutesUntil, isCanceled }: { minutesUntil: number; isCanceled: boolean }) {
  const { t } = useTranslation();
  if (isCanceled) return null;
  if (minutesUntil > 60) {
    const h = Math.floor(minutesUntil / 60);
    const m = minutesUntil % 60;
    return (
      <span className="text-smart-train-green font-medium text-sm">
        {t("tracker.departsInHoursMinutes", { hours: h, minutes: m })}
      </span>
    );
  }
  if (minutesUntil > 2) {
    return (
      <span className="text-smart-train-green font-medium text-sm">
        {t("tracker.departsInMinutes", { minutes: minutesUntil })}
      </span>
    );
  }
  if (minutesUntil >= -2) {
    return (
      <span className="text-smart-train-green font-semibold text-sm animate-pulse">
        {t("tracker.nowBoarding")}
      </span>
    );
  }
  return (
    <span className="text-muted-foreground text-sm">
      {t("tracker.departedMinutesAgo", { minutes: Math.abs(minutesUntil) })}
    </span>
  );
}

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
  const isCanceled = realtimeStatus?.isCanceled ?? false;
  const isOriginSkipped = realtimeStatus?.isOriginSkipped ?? false;
  const isCanceledOrSkipped = isCanceled || isOriginSkipped;
  const isDelayed = !isCanceledOrSkipped && realtimeStatus?.delayMinutes != null;
  const delayDisplay =
    realtimeStatus?.delayMinutes === 0
      ? "<1"
      : String(realtimeStatus?.delayMinutes ?? "");
  const showOnTimeBadge = isNextTrip && !isCanceledOrSkipped && !isDelayed;

  const departureTime = realtimeStatus?.liveDepartureTime ?? trip.departureTime;
  const arrivalTime = realtimeStatus?.liveArrivalTime ?? trip.arrivalTime;

  const minutesUntil = useCountdown(trip.departureTime, realtimeStatus?.liveDepartureTime, currentTime);
  const { lat, lng } = useGeolocation({
    watch: trackingEnabled,
    autoRequestOnNative: false,
  });

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
  const zones = calculateZonesBetweenStations(fromStation, toStation);
  const adultFare = (zones * FARE_CONSTANTS.ADULT_FARE_PER_ZONE).toFixed(2);

  // Stop count (intermediate stops between from and to, not including endpoints)
  const fromIdx = stationIndexMap[fromStation];
  const toIdx = stationIndexMap[toStation];
  const stopCount = Math.abs(toIdx - fromIdx) - 1; // stops in between

  const hasOutboundQuickConnection =
    showFerry &&
    trip.outboundFerry &&
    isQuickConnection(calculateTransferTime(trip.arrivalTime, trip.outboundFerry.depart));

  const hasInboundQuickConnection =
    trip.inboundFerry &&
    trip.fromStation === FERRY_CONSTANTS.FERRY_STATION &&
    isQuickConnection(calculateTransferTime(trip.inboundFerry.arrive, trip.departureTime));

  const hasQuickConnection = hasOutboundQuickConnection || hasInboundQuickConnection;

  const getTimeToneClass = (hasLiveTime: boolean) =>
    isCanceledOrSkipped
      ? "line-through text-destructive"
      : isDelayed || hasLiveTime
      ? "text-smart-gold"
      : isNextTrip
      ? "text-smart-train-green"
      : undefined;

  const trainOption = hasInboundQuickConnection ? t("quickConnection.laterTrain") : t("quickConnection.earlierTrain");

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header — mirrors trip card layout: badge | times | close */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-2 shrink-0">
        <TrainBadge
          tripNumber={trip.trip}
          isNextTrip={isNextTrip}
          isCanceled={isCanceled}
          isSkipped={isOriginSkipped}
          isDelayed={isDelayed}
        />

        {/* Times block — same structure as TripCard */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-lg">
            <TimeDisplay
              time={departureTime}
              format={timeFormat}
              className={getTimeToneClass(!!realtimeStatus?.liveDepartureTime)}
            />
            <span className="text-muted-foreground">→</span>
            <TimeDisplay
              time={arrivalTime}
              format={timeFormat}
              className={getTimeToneClass(!!realtimeStatus?.liveArrivalTime)}
            />
          </div>
          {/* Strikethrough original times when delayed */}
          {isDelayed && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
              <TimeDisplay time={trip.departureTime} format={timeFormat} className="text-xs line-through" />
              {realtimeStatus?.liveArrivalTime && (
                <>
                  <span>→</span>
                  <TimeDisplay time={trip.arrivalTime} format={timeFormat} className="text-xs line-through" />
                </>
              )}
            </div>
          )}
        </div>

        {showCloseButton && (
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-muted transition-colors shrink-0"
            aria-label={t("tracker.closeTripDetails")}
          >
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Status pills + countdown on same row */}
      <div className="px-4 pb-2 shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1">
        <TripStatusPills
          isCanceled={isCanceled}
          isOriginSkipped={isOriginSkipped}
          isDelayed={isDelayed}
          showOnTimeBadge={showOnTimeBadge}
          delayDisplay={delayDisplay}
        />
        <CountdownDisplay minutesUntil={minutesUntil} isCanceled={isCanceled} />
      </div>

      {/* Metadata row: duration · stops · fare */}
      <div className="px-4 pb-3 shrink-0 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" aria-hidden="true" />
          {tripDurationLabel}
        </span>
        {stopCount > 0 && (
          <span className="flex items-center gap-1">
            <MapPin className="h-3 w-3" aria-hidden="true" />
            {t("tracker.stopCount", { count: stopCount })}
          </span>
        )}
        <span className="flex items-center gap-1">
          <DollarSign className="h-3 w-3" aria-hidden="true" />
          {t("tracker.adultFare", { fare: adultFare })}
        </span>
      </div>

      {/* Quick connection warning */}
      {hasQuickConnection && !isCanceledOrSkipped && (
        <div className="mx-4 mb-3 p-3 rounded-lg bg-smart-gold/10 border border-smart-gold/40 flex items-start gap-2 shrink-0">
          <AlertTriangle className="h-4 w-4 text-smart-gold mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-smart-gold">{t("quickConnection.quickTransferWarning")}</p>
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

      <div className="mx-4 mb-1 border-t border-border shrink-0" />

      {/* Scrollable stop timeline */}
      <div className="flex-1 overflow-y-auto px-4 pt-2" style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}>
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

        {/* Ferry connection info */}
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

export function TripDetailSheet({
  isOpen,
  onClose,
  ...rest
}: TripDetailSheetProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const sheetRef = useRef<HTMLDivElement>(null);

  // Derive accent color class for the drag handle based on trip status
  const isCanceled = rest.realtimeStatus?.isCanceled ?? false;
  const isOriginSkipped = rest.realtimeStatus?.isOriginSkipped ?? false;
  const isDelayed = !(isCanceled || isOriginSkipped) && rest.realtimeStatus?.delayMinutes != null;
  const handleColor = isCanceled || isOriginSkipped
    ? "bg-destructive/60"
    : isDelayed
    ? "bg-smart-gold/60"
    : rest.isNextTrip
    ? "bg-smart-train-green/60"
    : "bg-muted-foreground/30";

  // Prevent body scroll when sheet is open on mobile
  useEffect(() => {
    if (!isMobile) return;
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [isOpen, isMobile]);

  // Swipe-to-dismiss for mobile bottom sheet
  const touchStartY = useRef<number | null>(null);
  const currentTranslateY = useRef(0);
  const DISMISS_TRANSITION = `transform ${SHEET_TRANSITION_MS}ms ${SHEET_EASING}`;

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    currentTranslateY.current = 0;
    if (sheetRef.current) {
      // Freeze at current position while dragging
      sheetRef.current.style.transition = "none";
      sheetRef.current.style.transform = "translateY(0)";
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current === null || !sheetRef.current) return;
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta < 0) return; // don't allow dragging up
    currentTranslateY.current = delta;
    sheetRef.current.style.transform = `translateY(${delta}px)`;
  };

  const handleTouchEnd = () => {
    if (!sheetRef.current) return;
    const el = sheetRef.current;

    if (currentTranslateY.current > 100) {
      // Dismiss: call onClose immediately so backdrop fades at the same time,
      // then animate the sheet the rest of the way off-screen via inline style
      // (inline style wins over the CSS class so no jumping)
      onClose();
      el.style.transition = DISMISS_TRANSITION;
      el.style.transform = "translateY(110%)";
      setTimeout(() => {
        // Class is now translate-y-full (100%) — close enough, clear inline style
        el.style.transform = "";
        el.style.transition = "";
      }, SHEET_TRANSITION_MS);
    } else {
      // Snap back: animate to 0, then hand control back to CSS class
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
          <div className="flex-1 overflow-hidden">
            <SheetContent
              {...rest}
              onClose={onClose}
              showCloseButton={true}
              trackingEnabled={isOpen}
            />
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
          "bg-card rounded-t-2xl shadow-elevated",
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
        {/* Drag handle — color reflects trip status */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className={cn("w-10 h-1 rounded-full", handleColor)} />
        </div>

        <SheetContent
          {...rest}
          onClose={onClose}
          showCloseButton={false}
          trackingEnabled={isOpen}
        />
      </div>
    </>,
    document.body
  );
}
