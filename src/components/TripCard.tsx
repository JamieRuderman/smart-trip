import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import { calculateTransferTime, isQuickConnection } from "@/lib/timeUtils";
import { FERRY_CONSTANTS } from "@/lib/fareConstants";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import { TimeDisplay } from "./TimeDisplay";
import { TrainBadge, NextTrainBadge } from "./TrainBadge";
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
}

export const TripCard = memo(function TripCard({
  trip,
  isNextTrip,
  isPastTrip,
  showAllTrips,
  showFerry,
  timeFormat,
}: TripCardProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const departureTime = trip.departureTime;
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

  return (
    <>
      <div
        className={cn(
          "flex items-center px-4 py-2 rounded-lg border transition-all ",
          "bg-gradient-card",
          "touch-manipulation", // Improve touch responsiveness
          hasQuickConnection && "cursor-pointer hover:bg-amber-50/50",
          isNextTrip
            ? "ring-2 ring-smart-train-green/50 bg-smart-train-green/5"
            : "focus:bg-none focus:ring-2 focus:ring-smart-gold focus:bg-smart-gold/5 focus:border-smart-gold/20"
        )}
        role="listitem"
        aria-label={`Train ${
          trip.trip
        }, departs ${departureTime}, arrives ${arrivalTime}${
          isNextTrip ? ` - ${t("tripCard.nextTrain")}` : ""
        }${isPastTrip ? ` - ${t("tripCard.departed")}` : ""}${
          hasQuickConnection ? ` - ${t("tripCard.tapForTransferWarning")}` : ""
        }`}
        tabIndex={0}
        onClick={hasQuickConnection ? () => setIsModalOpen(true) : undefined}
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
                <TimeDisplay time={departureTime} format={timeFormat} />
                <span className="text-muted-foreground">→</span>
                <TimeDisplay time={arrivalTime} format={timeFormat} />
              </div>
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
                isNextTrip={isNextTrip}
                format={timeFormat}
                className="text-right min-w-20"
              />
              <span className="text-muted-foreground">→</span>
              <TimeDisplay
                time={arrivalTime}
                isNextTrip={isNextTrip}
                format={timeFormat}
              />
            </div>
            {isNextTrip && <NextTrainBadge />}
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

      {hasQuickConnection && (
        <QuickConnectionModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          isInbound={hasInboundQuickConnection}
        />
      )}
    </>
  );
});
