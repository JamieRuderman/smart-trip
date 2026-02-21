import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import { calculateTransferTime, isQuickConnection } from "@/lib/timeUtils";
import { FERRY_CONSTANTS } from "@/lib/fareConstants";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import { TimeDisplay } from "./TimeDisplay";
import { TrainBadge } from "./TrainBadge";
import { PillBadge } from "./PillBadge";
import { FerryConnection } from "./FerryConnection";
import { QuickConnectionModal } from "./QuickConnectionModal";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTranslation } from "react-i18next";

interface TripCardProps {
  trip: ProcessedTrip;
  isNextTrip: boolean;
  isPastTrip: boolean;
  showAllTrips: boolean;
  showFerry: boolean;
  timeFormat: "12h" | "24h";
  realtimeStatus?: TripRealtimeStatus | null;
}

export const TripCard = memo(function TripCard({
  trip,
  isNextTrip,
  isPastTrip,
  showAllTrips,
  showFerry,
  timeFormat,
  realtimeStatus,
}: TripCardProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const isCanceled = realtimeStatus?.isCanceled ?? false;
  const isOriginSkipped = realtimeStatus?.isOriginSkipped ?? false;
  // Use live departure time when available, otherwise fall back to static scheduled time
  const departureTime = realtimeStatus?.liveDepartureTime ?? trip.departureTime;
  const arrivalTime = trip.arrivalTime;
  const [isModalOpen, setIsModalOpen] = useState(false);

  const hasOutboundQuickConnection =
    showFerry &&
    trip.outboundFerry &&
    isQuickConnection(
      calculateTransferTime(trip.arrivalTime, trip.outboundFerry.depart)
    );

  const hasInboundQuickConnection =
    trip.inboundFerry &&
    trip.fromStation === FERRY_CONSTANTS.FERRY_STATION &&
    isQuickConnection(
      calculateTransferTime(trip.inboundFerry.arrive, trip.departureTime)
    );

  const hasQuickConnection =
    hasOutboundQuickConnection || hasInboundQuickConnection;

  const realtimeBadges = (
    <>
      {isCanceled && (
        <PillBadge
          label={t("tripCard.canceled")}
          color="gold"
          className="bg-destructive"
        />
      )}
      {isOriginSkipped && !isCanceled && (
        <PillBadge
          label={t("tripCard.stopSkipped")}
          color="gold"
          className="bg-destructive"
        />
      )}
      {!isCanceled && !isOriginSkipped && realtimeStatus?.delayMinutes != null && (
        <PillBadge
          label={t("tripCard.delayed", { minutes: realtimeStatus.delayMinutes })}
          color="gold"
        />
      )}
    </>
  );

  return (
    <>
      <div
        className={cn(
          "flex items-center px-4 py-2 rounded-lg border transition-all ",
          "bg-gradient-card",
          "touch-manipulation", // Improve touch responsiveness
          isCanceled && "opacity-60",
          hasQuickConnection && !isCanceled && "cursor-pointer hover:bg-amber-50/50",
          isNextTrip && !isCanceled
            ? "ring-2 ring-smart-train-green/50 bg-smart-train-green/5"
            : "focus:bg-none focus:ring-2 focus:ring-smart-gold focus:bg-smart-gold/5 focus:border-smart-gold/20"
        )}
        role="listitem"
        aria-label={`Train ${
          trip.trip
        }, departs ${departureTime}, arrives ${arrivalTime}${
          isCanceled ? ` - ${t("tripCard.canceled")}` : ""
        }${isOriginSkipped ? ` - ${t("tripCard.stopSkipped")}` : ""}${
          isNextTrip && !isCanceled ? ` - ${t("tripCard.nextTrain")}` : ""
        }${isPastTrip ? ` - ${t("tripCard.departed")}` : ""}${
          hasQuickConnection ? ` - ${t("tripCard.tapForTransferWarning")}` : ""
        }`}
        tabIndex={0}
        onClick={hasQuickConnection && !isCanceled ? () => setIsModalOpen(true) : undefined}
      >
        <TrainBadge
          tripNumber={trip.trip}
          isNextTrip={isNextTrip}
          isPastTrip={isPastTrip}
          showAllTrips={showAllTrips}
        />
        {isMobile ? (
          <div className="flex flex-col items-start ml-4 w-full">
            <div className="flex flex-row gap-2 w-full items-center justify-between">
              <div className="flex flex-row gap-2 items-center text-lg whitespace-nowrap">
                <TimeDisplay
                  time={departureTime}
                  format={timeFormat}
                  className={cn(isCanceled && "line-through")}
                />
                <span className="text-muted-foreground">→</span>
                <TimeDisplay time={arrivalTime} format={timeFormat} />
              </div>
              <div className="flex gap-1">{realtimeBadges}</div>
            </div>
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
            <div className="flex flex-row gap-2 text-md">
              <TimeDisplay
                time={departureTime}
                isNextTrip={isNextTrip && !isCanceled}
                format={timeFormat}
                className={cn("text-right min-w-20", isCanceled && "line-through")}
              />
              <span className="text-muted-foreground">→</span>
              <TimeDisplay
                time={arrivalTime}
                isNextTrip={isNextTrip && !isCanceled}
                format={timeFormat}
              />
            </div>
            {realtimeBadges}
            {isNextTrip && !isCanceled && (
              <PillBadge label={t("tripCard.nextTrain")} color="green" />
            )}
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

      {hasQuickConnection && !isCanceled && (
        <QuickConnectionModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          isInbound={hasInboundQuickConnection}
        />
      )}
    </>
  );
});
