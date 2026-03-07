import { memo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";
import { TimeDisplay } from "./TimeDisplay";
import { TrainBadge } from "./TrainBadge";
import { TripStatusPills } from "./TripStatusPills";
import { FerryConnection } from "./FerryConnection";
import { TripDetailSheet } from "./TripDetailSheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTranslation } from "react-i18next";
import { FERRY_CONSTANTS } from "@/lib/fareConstants";
import { calculateTransferTime, isQuickConnection } from "@/lib/timeUtils";

interface TripCardProps {
  trip: ProcessedTrip;
  isNextTrip: boolean;
  isPastTrip: boolean;
  showAllTrips: boolean;
  showFerry: boolean;
  timeFormat: "12h" | "24h";
  realtimeStatus?: TripRealtimeStatus | null;
  fromStation: Station;
  toStation: Station;
  currentTime: Date;
}

export const TripCard = memo(function TripCard({
  trip,
  isNextTrip,
  isPastTrip,
  showAllTrips,
  showFerry,
  timeFormat,
  realtimeStatus,
  fromStation,
  toStation,
  currentTime,
}: TripCardProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const isCanceled = realtimeStatus?.isCanceled ?? false;
  const isOriginSkipped = realtimeStatus?.isOriginSkipped ?? false;
  const isCanceledOrSkipped = isCanceled || isOriginSkipped;
  const cardRef = useRef<HTMLDivElement>(null);
  const departureTime = realtimeStatus?.liveDepartureTime ?? trip.departureTime;
  const arrivalTime = realtimeStatus?.liveArrivalTime ?? trip.arrivalTime;
  const [isDetailOpen, setIsDetailOpen] = useState(false);

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

  const isDelayed =
    !isCanceledOrSkipped && realtimeStatus?.delayMinutes != null;
  const showOnTimeBadge = isNextTrip && !isCanceledOrSkipped && !isDelayed;
  const hasLiveDepartureTime = realtimeStatus?.liveDepartureTime != null;
  const hasLiveArrivalTime = realtimeStatus?.liveArrivalTime != null;
  const delayDisplay =
    realtimeStatus?.delayMinutes === 0
      ? "<1"
      : String(realtimeStatus?.delayMinutes ?? "");

  const getTimeToneClass = (hasLiveTime: boolean) =>
    isCanceledOrSkipped
      ? "line-through text-destructive"
      : isDelayed || hasLiveTime
      ? "text-smart-gold"
      : isNextTrip
      ? "text-smart-train-green"
      : undefined;

  const handleCardClick = () => {
    setIsDetailOpen(true);
  };

  const handleDetailClose = () => {
    setIsDetailOpen(false);
    requestAnimationFrame(() => {
      cardRef.current?.focus({ preventScroll: true });
    });
  };

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
          "flex items-center px-4 py-2 rounded-lg border-2 transition-all",
          "touch-manipulation cursor-pointer",
          "focus:outline-none",
          isCanceledOrSkipped
            ? "bg-destructive/5 border-destructive/30 hover:bg-destructive/10 focus:border-destructive/75 focus:shadow-[0_0_0_1px_hsl(var(--destructive)/0.75)]"
            : isDelayed
            ? "bg-smart-gold/5 border-smart-gold/30 hover:bg-smart-gold/10 focus:border-smart-gold/80 focus:shadow-[0_0_0_1px_hsl(var(--smart-gold)/0.8)]"
            : isNextTrip
            ? "bg-smart-train-green/5 border-smart-train-green/30 hover:bg-smart-train-green/10 focus:border-smart-train-green/80 focus:shadow-[0_0_0_1px_hsl(var(--smart-train-green)/0.8)]"
            : "bg-gradient-card border-border hover:bg-muted/50 focus:border-foreground/45 focus:shadow-[0_0_0_1px_hsl(var(--foreground)/0.45)]",
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
              <span className="text-muted-foreground">→</span>
              <div className="flex flex-col">
                <TimeDisplay
                  time={arrivalTime}
                  format={timeFormat}
                  className={getTimeToneClass(hasLiveArrivalTime)}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-1 mt-0.5">
              <TripStatusPills
                isCanceled={isCanceled}
                isOriginSkipped={isOriginSkipped}
                isDelayed={isDelayed}
                showOnTimeBadge={showOnTimeBadge}
                delayDisplay={delayDisplay}
              />
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
                isMobile
              />
            )}
            {trip.inboundFerry &&
              trip.fromStation === FERRY_CONSTANTS.FERRY_STATION && (
                <FerryConnection
                  ferry={trip.inboundFerry}
                  trainDepartureTime={departureTime}
                  timeFormat={timeFormat}
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
              <span className="text-muted-foreground">→</span>
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
            <TripStatusPills
              isCanceled={isCanceled}
              isOriginSkipped={isOriginSkipped}
              isDelayed={isDelayed}
              showOnTimeBadge={showOnTimeBadge}
              delayDisplay={delayDisplay}
            />
            {showFerry && trip.outboundFerry && (
              <FerryConnection
                ferry={trip.outboundFerry}
                trainArrivalTime={arrivalTime}
                timeFormat={timeFormat}
              />
            )}
            {trip.inboundFerry &&
              trip.fromStation === FERRY_CONSTANTS.FERRY_STATION && (
                <FerryConnection
                  ferry={trip.inboundFerry}
                  trainDepartureTime={departureTime}
                  timeFormat={timeFormat}
                  inbound
                />
              )}
          </div>
        )}
      </div>

      <TripDetailSheet
        isOpen={isDetailOpen}
        onClose={handleDetailClose}
        trip={trip}
        fromStation={fromStation}
        toStation={toStation}
        currentTime={currentTime}
        realtimeStatus={realtimeStatus}
        timeFormat={timeFormat}
        isNextTrip={isNextTrip}
        showFerry={showFerry}
      />
    </>
  );
});
