import { cn } from "@/lib/utils";
import {
  stationIndexMap,
  getAllStations,
  getClosestStationWithDistance,
} from "@/lib/stationUtils";
import { parseTimeToMinutes } from "@/lib/timeUtils";
import { TimeDisplay } from "./TimeDisplay";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";
import { MapPin, Circle } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

interface StopTimelineProps {
  trip: ProcessedTrip;
  fromStation: Station;
  toStation: Station;
  currentTime: Date;
  realtimeStatus?: TripRealtimeStatus | null;
  timeFormat: "12h" | "24h";
  currentLat?: number | null;
  currentLng?: number | null;
}

type StopState = "past" | "current" | "future";

const HIGH_CONFIDENCE_DISTANCE_KM = 1.2;

function clampIndex(index: number, length: number): number {
  if (length === 0) return 0;
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
}

export function StopTimeline({
  trip,
  fromStation,
  toStation,
  currentTime,
  realtimeStatus,
  timeFormat,
  currentLat,
  currentLng,
}: StopTimelineProps) {
  const { t } = useTranslation();
  const allStations = getAllStations();
  const fromIdx = stationIndexMap[fromStation];
  const toIdx = stationIndexMap[toStation];

  const minIdx = Math.min(fromIdx, toIdx);
  const maxIdx = Math.max(fromIdx, toIdx);
  const isSouthbound = fromIdx < toIdx;

  const stops = allStations.slice(minIdx, maxIdx + 1);
  const times = trip.times.slice(minIdx, maxIdx + 1);

  const displayStops = isSouthbound ? stops : [...stops].reverse();
  const displayTimes = isSouthbound ? times : [...times].reverse();

  const allStopLiveDepartures = realtimeStatus?.allStopLiveDepartures;
  const hasRealtimeStopData = realtimeStatus?.hasRealtimeStopData ?? false;

  const nowMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();

  const inferred = useMemo(() => {
    const statusByStop = displayStops.map((station, i) => {
      const staticTime = displayTimes[i] ?? "";
      const liveTime = allStopLiveDepartures?.[station];
      const reference = liveTime ?? staticTime;
      const parsed = reference ? parseTimeToMinutes(reference) : Number.NaN;
      const isPast = Number.isFinite(parsed) ? parsed <= nowMinutes : false;
      return {
        station,
        staticTime,
        liveTime,
        parsed,
        isPast,
      };
    });

    let confidence: "high" | "medium" | "low" = "low";
    let currentIndex = -1;

    if (currentLat != null && currentLng != null) {
      const closest = getClosestStationWithDistance(currentLat, currentLng);
      const idx = displayStops.indexOf(closest.station);
      if (idx >= 0 && closest.distanceKm <= HIGH_CONFIDENCE_DISTANCE_KM) {
        confidence = "high";
        currentIndex = idx;
      }
    }

    if (currentIndex === -1) {
      let lastPast = -1;
      for (let i = 0; i < statusByStop.length; i += 1) {
        if (statusByStop[i].isPast) {
          lastPast = i;
        }
      }
      currentIndex = clampIndex(lastPast >= 0 ? lastPast : 0, statusByStop.length);

      if (hasRealtimeStopData && statusByStop.some((s) => s.liveTime)) {
        confidence = "medium";
      }
    }

    const states: StopState[] = statusByStop.map((stop, index) => {
      void stop;
      if (index < currentIndex) return "past";
      if (index === currentIndex) return "current";
      return "future";
    });

    return { statusByStop, states, currentIndex, confidence };
  }, [
    currentLat,
    currentLng,
    displayStops,
    displayTimes,
    allStopLiveDepartures,
    nowMinutes,
    hasRealtimeStopData,
  ]);

  const isCanceled = realtimeStatus?.isCanceled ?? false;
  const isDelayed = !isCanceled && realtimeStatus?.delayMinutes != null;
  const delayMinutes = realtimeStatus?.delayMinutes;

  return (
    <div className="flex flex-col">
      {isDelayed && delayMinutes != null && (
        <p className="text-xs text-smart-gold mb-3 px-1">
          {t("tracker.runningLate", { minutes: delayMinutes })}
        </p>
      )}
      {isCanceled && (
        <p className="text-xs text-destructive mb-3 px-1">
          {t("tracker.tripCanceled")}
        </p>
      )}
      {!isCanceled && (
        <p className="text-xs text-muted-foreground mb-3 px-1">
          {inferred.confidence === "high"
            ? t("tracker.confidenceHigh")
            : inferred.confidence === "medium"
            ? t("tracker.confidenceMedium")
            : t("tracker.confidenceLow")}
        </p>
      )}

      <div className="relative">
        {displayStops.map((station, i) => {
          const time = displayTimes[i];
          const hasTime = time && time !== "--" && time !== "";

          const isFrom = station === fromStation;
          const isTo = station === toStation;
          const state = inferred.states[i];
          const isPast = state === "past";
          const isCurrent = state === "current";
          const isFirst = i === 0;
          const isLast = i === displayStops.length - 1;

          const liveStopTime = allStopLiveDepartures?.[station];
          const showLiveStopTime =
            liveStopTime && !isCanceled && hasTime && liveStopTime !== time;

          const showLiveFrom = isFrom && isDelayed && realtimeStatus?.liveDepartureTime;
          const showLiveTo =
            isTo && !isFrom && isDelayed && realtimeStatus?.liveArrivalTime;

          const isBoardingStop = isFrom && !isPast;
          const isDepartedStop = isFrom && isPast;

          return (
            <div key={station} className="flex items-start gap-3 relative">
              <div className="flex flex-col items-center w-5 shrink-0">
                <div
                  className={cn(
                    "w-px flex-1",
                    isFirst ? "invisible" : isPast ? "bg-muted-foreground/40" : "bg-border"
                  )}
                  style={{ minHeight: 8 }}
                />

                {isFrom || isTo ? (
                  <MapPin
                    className={cn(
                      "h-4 w-4 shrink-0",
                      isCanceled
                        ? "text-destructive"
                        : isPast && isFrom
                        ? "text-muted-foreground"
                        : isFrom
                        ? "text-smart-train-green"
                        : "text-primary"
                    )}
                  />
                ) : isCurrent ? (
                  <div className="h-3 w-3 rounded-full bg-smart-train-green shadow-[0_0_6px_2px_hsl(var(--smart-train-green)/0.4)] shrink-0" />
                ) : isPast ? (
                  <Circle className="h-3 w-3 text-muted-foreground/50 fill-muted-foreground/20 shrink-0" />
                ) : (
                  <Circle className="h-3 w-3 text-border shrink-0" />
                )}

                <div
                  className={cn(
                    "w-px flex-1",
                    isLast ? "invisible" : isPast || isCurrent ? "bg-muted-foreground/40" : "bg-border"
                  )}
                  style={{ minHeight: 8 }}
                />
              </div>

              <div
                className={cn(
                  "flex items-center justify-between w-full py-1.5 min-h-[36px]",
                  isPast && !isFrom && !isTo && "opacity-40"
                )}
              >
                <div className="flex flex-col">
                  <span
                    className={cn(
                      "text-sm leading-tight",
                      isFrom || isTo
                        ? isCanceled
                          ? "text-destructive font-medium"
                          : isPast && isFrom
                          ? "text-muted-foreground font-medium"
                          : "text-smart-train-green font-semibold"
                        : isCurrent
                        ? "font-medium"
                        : "text-foreground"
                    )}
                  >
                    {station}
                  </span>
                  {isBoardingStop && (
                    <span className="text-xs text-smart-train-green/80">
                      {t("tracker.boarding")}
                    </span>
                  )}
                  {isDepartedStop && (
                    <span className="text-xs text-muted-foreground">
                      {t("tracker.departed")}
                    </span>
                  )}
                  {isTo && !isFrom && (
                    <span className="text-xs text-primary/80">{t("tracker.arriving")}</span>
                  )}
                </div>

                {hasTime && (
                  <div className="flex flex-col items-end shrink-0 ml-2">
                    {showLiveFrom && (
                      <>
                        <TimeDisplay
                          time={realtimeStatus!.liveDepartureTime!}
                          format={timeFormat}
                          className="text-sm text-smart-gold"
                        />
                        <TimeDisplay
                          time={time}
                          format={timeFormat}
                          className="text-xs line-through text-muted-foreground"
                        />
                      </>
                    )}
                    {showLiveTo && (
                      <>
                        <TimeDisplay
                          time={realtimeStatus!.liveArrivalTime!}
                          format={timeFormat}
                          className="text-sm text-smart-gold"
                        />
                        <TimeDisplay
                          time={time}
                          format={timeFormat}
                          className="text-xs line-through text-muted-foreground"
                        />
                      </>
                    )}
                    {!showLiveFrom && !showLiveTo && (
                      <>
                        {showLiveStopTime && (
                          <TimeDisplay
                            time={liveStopTime!}
                            format={timeFormat}
                            className="text-sm text-smart-gold"
                          />
                        )}
                        <TimeDisplay
                          time={time}
                          format={timeFormat}
                          className={cn(
                            showLiveStopTime
                              ? "text-xs line-through text-muted-foreground"
                              : "text-sm",
                            !showLiveStopTime &&
                              (isCanceled
                                ? "line-through text-destructive"
                                : isFrom && !isPast
                                ? "text-smart-train-green"
                                : isPast
                                ? "text-muted-foreground"
                                : "text-foreground")
                          )}
                        />
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
