import { memo, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";
import { TimeDisplay } from "./TimeDisplay";
import { TrainBadge } from "./TrainBadge";
import { FerryConnection } from "./FerryConnection";
import { TripDetailSheet } from "./TripDetailSheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTripStatus } from "@/hooks/useTripStatus";
import { stateText, stateCardStyle, cardTripState } from "@/lib/tripTheme";
import { useTranslation } from "react-i18next";
import { FERRY_CONSTANTS } from "@/lib/fareConstants";
import { calculateTransferTime, isQuickConnection } from "@/lib/timeUtils";
import { SHEET_ENTER_DELAY_MS, SHEET_TRANSITION_MS } from "@/lib/animationConstants";

interface TripCardProps {
  trip: ProcessedTrip;
  isNextTrip: boolean;
  isPastTrip: boolean;
  showAllTrips: boolean;
  showFerry: boolean;
  timeFormat: "12h" | "24h";
  realtimeStatus?: TripRealtimeStatus | null;
  lastUpdated: Date | null;
  fromStation: Station;
  toStation: Station;
  currentTime: Date;
  selectedTripNumber: number | null;
  onSelectTrip: (tripNumber: number | null) => void;
}

export const TripCard = memo(function TripCard({
  trip,
  isNextTrip,
  isPastTrip,
  showAllTrips,
  showFerry,
  timeFormat,
  realtimeStatus,
  lastUpdated,
  fromStation,
  toStation,
  currentTime,
  selectedTripNumber,
  onSelectTrip,
}: TripCardProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { isCanceled, isOriginSkipped, isCanceledOrSkipped, isDelayed } =
    useTripStatus(realtimeStatus);
  const cardRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const departureTime = realtimeStatus?.liveDepartureTime ?? trip.departureTime;
  const arrivalTime = realtimeStatus?.liveArrivalTime ?? trip.arrivalTime;

  // Derive open state from URL-synced selectedTripNumber
  const isOpen = selectedTripNumber === trip.trip;

  // Animation state — driven by isOpen prop, initialized to match it (deep-link case)
  const [isDetailOpen, setIsDetailOpen] = useState(isOpen);
  const [isDetailMounted, setIsDetailMounted] = useState(isOpen);
  const isFirstRender = useRef(true);

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

  const hasLiveDepartureTime = realtimeStatus?.liveDepartureTime != null;
  const hasLiveArrivalTime = realtimeStatus?.liveArrivalTime != null;

  const cardState = cardTripState({ isCanceledOrSkipped, isDelayed, isNextTrip, isPastTrip });

  const getTimeToneClass = (hasLiveTime: boolean) =>
    isCanceledOrSkipped
      ? cn("line-through", stateText["canceled"])
      : isDelayed || hasLiveTime
      ? stateText["delayed"]
      : isNextTrip
      ? stateText["ontime"]
      : isPastTrip
      ? stateText["past"]
      : undefined;

  const handleCardClick = useCallback(() => {
    onSelectTrip(trip.trip);
  }, [onSelectTrip, trip.trip]);

  const handleDetailClose = useCallback(() => {
    onSelectTrip(null);
  }, [onSelectTrip]);

  // Drive sheet animation from the URL-synced isOpen prop
  useEffect(() => {
    // Skip on initial mount — animation state already seeded from isOpen (deep-link case)
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (openTimerRef.current != null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (isOpen) {
      // Mount closed first, then open slightly later so browser paints initial state
      setIsDetailOpen(false);
      setIsDetailMounted(true);
      openTimerRef.current = window.setTimeout(() => {
        setIsDetailOpen(true);
        openTimerRef.current = null;
      }, SHEET_ENTER_DELAY_MS);
    } else {
      setIsDetailOpen(false);
      closeTimerRef.current = window.setTimeout(() => {
        setIsDetailMounted(false);
        requestAnimationFrame(() => {
          cardRef.current?.focus({ preventScroll: true });
        });
        closeTimerRef.current = null;
      }, SHEET_TRANSITION_MS);
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current != null) {
        window.clearTimeout(closeTimerRef.current);
      }
      if (openTimerRef.current != null) {
        window.clearTimeout(openTimerRef.current);
      }
    };
  }, []);

  const ariaParts = [
    `Train ${trip.trip}`,
    `departs ${departureTime}`,
    `arrives ${arrivalTime}`,
    isCanceled ? t("tripCard.canceled") : null,
    isOriginSkipped ? t("tripCard.stopSkipped") : null,
    isNextTrip ? t("tripCard.nextTrain") : null,
    isPastTrip ? t("tripCard.departed") : null,
    hasOutboundQuickConnection || hasInboundQuickConnection
      ? t("tripCard.tapForTransferWarning")
      : null,
  ].filter(Boolean);

  return (
    <>
      <div
        ref={cardRef}
        className={cn(
          "flex items-center px-4 py-2 rounded-lg border transition-all",
          "touch-manipulation cursor-pointer",
          "focus:outline-none",
          stateCardStyle[cardState],
        )}
        role="listitem"
        aria-label={ariaParts.join(", ")}
        tabIndex={0}
        onClick={handleCardClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleCardClick();
          }
        }}
      >
        <TrainBadge
          tripNumber={trip.trip}
          isNextTrip={isNextTrip}
          isPastTrip={isPastTrip}
          showAllTrips={showAllTrips}
          isCanceled={isCanceled}
          isSkipped={isOriginSkipped}
          isDelayed={isDelayed}
        />
        {isMobile ? (
          <div className="flex flex-col items-start ml-4 w-full">
            <div className="flex flex-row gap-2 items-start text-lg whitespace-nowrap">
              <div className="flex flex-col">
                <TimeDisplay
                  time={departureTime}
                  format={timeFormat}
                  className={getTimeToneClass(hasLiveDepartureTime)}
                />
              </div>
              <span className={cardState === "future" ? "text-muted-foreground" : stateText[cardState]}>→</span>
              <div className="flex flex-col">
                <TimeDisplay
                  time={arrivalTime}
                  format={timeFormat}
                  className={getTimeToneClass(hasLiveArrivalTime)}
                />
              </div>
            </div>
            {isDelayed && (
              <div className="flex flex-row gap-2 items-start text-xs text-muted-foreground whitespace-nowrap mt-2">
                <TimeDisplay
                  time={trip.departureTime}
                  format={timeFormat}
                  className="text-xs line-through"
                />
                {realtimeStatus?.liveArrivalTime != null && (
                  <>
                    <span>→</span>
                    <TimeDisplay
                      time={trip.arrivalTime}
                      format={timeFormat}
                      className="text-xs line-through"
                    />
                  </>
                )}
              </div>
            )}
            {showFerry && trip.outboundFerry && (
              <FerryConnection
                ferry={trip.outboundFerry}
                trainArrivalTime={arrivalTime}
                timeFormat={timeFormat}
                currentTime={currentTime}
                isMobile
              />
            )}
            {trip.inboundFerry &&
              trip.fromStation === FERRY_CONSTANTS.FERRY_STATION && (
                <FerryConnection
                  ferry={trip.inboundFerry}
                  trainDepartureTime={departureTime}
                  timeFormat={timeFormat}
                  currentTime={currentTime}
                  isMobile
                  inbound
                />
              )}
          </div>
        ) : (
          <div className="flex flex-col md:flex-row items-center gap-4 w-full">
            <div className="flex flex-row gap-2 text-md items-start">
              <div className="flex flex-col min-w-20 items-end">
                <TimeDisplay
                  time={departureTime}
                  isNextTrip={false}
                  format={timeFormat}
                  className={cn(
                    "text-right min-w-20",
                    getTimeToneClass(hasLiveDepartureTime),
                  )}
                />
                {isDelayed && (
                  <TimeDisplay
                    time={trip.departureTime}
                    format={timeFormat}
                    className="text-xs line-through text-muted-foreground"
                  />
                )}
              </div>
              <span className={cardState === "future" ? "text-muted-foreground" : stateText[cardState]}>→</span>
              <div className="flex flex-col">
                <TimeDisplay
                  time={arrivalTime}
                  isNextTrip={false}
                  format={timeFormat}
                  className={getTimeToneClass(hasLiveArrivalTime)}
                />
                {isDelayed && realtimeStatus?.liveArrivalTime != null && (
                  <TimeDisplay
                    time={trip.arrivalTime}
                    format={timeFormat}
                    className="text-xs line-through text-muted-foreground"
                  />
                )}
              </div>
            </div>
            {isNextTrip && !isCanceledOrSkipped && !isDelayed && (
              <span className="text-xs px-2 py-0.5 rounded-md font-medium whitespace-nowrap bg-primary text-primary-foreground">
                {t("tripCard.nextTrain")}
              </span>
            )}
            {showFerry && trip.outboundFerry && (
              <FerryConnection
                ferry={trip.outboundFerry}
                trainArrivalTime={arrivalTime}
                timeFormat={timeFormat}
                currentTime={currentTime}
              />
            )}
            {trip.inboundFerry &&
              trip.fromStation === FERRY_CONSTANTS.FERRY_STATION && (
                <FerryConnection
                  ferry={trip.inboundFerry}
                  trainDepartureTime={departureTime}
                  timeFormat={timeFormat}
                  currentTime={currentTime}
                  inbound
                />
              )}
          </div>
        )}
      </div>

      {isDetailMounted && (
        <TripDetailSheet
          isOpen={isDetailOpen}
          onClose={handleDetailClose}
          trip={trip}
          fromStation={fromStation}
          toStation={toStation}
          currentTime={currentTime}
          lastUpdated={lastUpdated}
          realtimeStatus={realtimeStatus}
          timeFormat={timeFormat}
          isNextTrip={isNextTrip}
          showFerry={showFerry}
        />
      )}
    </>
  );
});
