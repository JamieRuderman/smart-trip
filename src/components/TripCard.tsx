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
  // Use live departure/arrival times when available, otherwise fall back to static scheduled times
  const departureTime = realtimeStatus?.liveDepartureTime ?? trip.departureTime;
  const arrivalTime = realtimeStatus?.liveArrivalTime ?? trip.arrivalTime;
  const [isModalOpen, setIsModalOpen] = useState(false);

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

  const isDelayed =
    !isCanceled && !isOriginSkipped && realtimeStatus?.delayMinutes != null;
  const nextPillColor =
    isCanceled || isOriginSkipped || isDelayed ? "neutral" : "green";
  const delayDisplay =
    realtimeStatus?.delayMinutes === 0
      ? "<1"
      : String(realtimeStatus?.delayMinutes ?? "");
  const arrivalDelayMinutes =
    realtimeStatus?.arrivalDelayMinutes ?? realtimeStatus?.delayMinutes;
  const arrivalDelayDisplay =
    arrivalDelayMinutes === 0 ? "<1" : String(arrivalDelayMinutes ?? "");

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
      {!isCanceled &&
        !isOriginSkipped &&
        realtimeStatus?.delayMinutes != null && (
          <PillBadge
            label={t("tripCard.delayed", { minutes: delayDisplay })}
            color="gold"
          />
        )}
    </>
  );

  return (
    <>
      <div
        className={cn(
          "flex items-center px-4 py-2 rounded-lg border transition-all",
          "touch-manipulation",
          "focus:ring-[3px] focus:ring-inset focus:outline-none",
          hasQuickConnection &&
            !isCanceled &&
            "cursor-pointer hover:bg-smart-train-green/5",
          isCanceled || isOriginSkipped
            ? "bg-destructive/5 border-destructive/30 focus:ring-destructive/50"
            : isDelayed
            ? "bg-smart-gold/5 border-smart-gold/30 focus:ring-smart-gold/60"
            : isNextTrip
            ? "bg-smart-train-green/5 border-smart-train-green/30 focus:ring-smart-train-green/60"
            : "bg-gradient-card focus:ring-black/20",
        )}
        role="listitem"
        aria-label={`Train ${
          trip.trip
        }, departs ${departureTime}, arrives ${arrivalTime}${
          isCanceled ? ` - ${t("tripCard.canceled")}` : ""
        }${isOriginSkipped ? ` - ${t("tripCard.stopSkipped")}` : ""}${
          isNextTrip ? ` - ${t("tripCard.nextTrain")}` : ""
        }${isPastTrip ? ` - ${t("tripCard.departed")}` : ""}${
          hasQuickConnection ? ` - ${t("tripCard.tapForTransferWarning")}` : ""
        }`}
        tabIndex={0}
        onClick={
          hasQuickConnection && !isCanceled
            ? () => setIsModalOpen(true)
            : undefined
        }
      >
        <TrainBadge
          tripNumber={trip.trip}
          isNextTrip={isNextTrip}
          isPastTrip={isPastTrip}
          showAllTrips={showAllTrips}
          isCanceled={isCanceled}
          isDelayed={isDelayed}
        />
        {isMobile ? (
          <div className="flex flex-col items-start ml-4 w-full">
            <div className="flex flex-row gap-2 items-start text-lg whitespace-nowrap">
              <div className="flex flex-col">
                <TimeDisplay
                  time={departureTime}
                  format={timeFormat}
                  className={cn(
                    isCanceled
                      ? "line-through text-destructive"
                      : realtimeStatus?.liveDepartureTime != null
                      ? "text-smart-gold"
                      : isNextTrip && "text-smart-train-green",
                  )}
                />
                {isDelayed && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <TimeDisplay
                      time={trip.departureTime}
                      format={timeFormat}
                      className="text-xs"
                    />
                    <span>+{delayDisplay} min</span>
                  </div>
                )}
              </div>
              <span className="text-muted-foreground">→</span>
              <div className="flex flex-col">
                <TimeDisplay
                  time={arrivalTime}
                  format={timeFormat}
                  className={cn(
                    isCanceled
                      ? "line-through text-destructive"
                      : realtimeStatus?.liveArrivalTime != null
                      ? "text-smart-gold"
                      : isNextTrip && "text-smart-train-green",
                  )}
                />
                {isDelayed && realtimeStatus?.liveArrivalTime != null && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <TimeDisplay
                      time={trip.arrivalTime}
                      format={timeFormat}
                      className="text-xs"
                    />
                    <span>+{arrivalDelayDisplay} min</span>
                  </div>
                )}
              </div>
            </div>
            {(isCanceled || isOriginSkipped) && (
              <div className="flex gap-1 mt-0.5">
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
                  isNextTrip={isNextTrip && !isCanceled}
                  format={timeFormat}
                  className={cn(
                    "text-right min-w-20",
                    isCanceled && "line-through text-destructive",
                    realtimeStatus?.liveDepartureTime != null &&
                      "text-smart-gold",
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
                  isNextTrip={isNextTrip && !isCanceled}
                  format={timeFormat}
                  className={cn(
                    isCanceled && "line-through text-destructive",
                    realtimeStatus?.liveArrivalTime != null &&
                      "text-smart-gold",
                  )}
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
            {isNextTrip && (
              <PillBadge
                label={t("tripCard.nextTrain")}
                color={nextPillColor}
              />
            )}
            {realtimeBadges}
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
