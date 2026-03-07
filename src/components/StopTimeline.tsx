import { cn } from "@/lib/utils";
import { stationIndexMap, getAllStations } from "@/lib/stationUtils";
import { parseTimeToMinutes } from "@/lib/timeUtils";
import { TimeDisplay } from "./TimeDisplay";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";
import { MapPin, Circle } from "lucide-react";

interface StopTimelineProps {
  trip: ProcessedTrip;
  fromStation: Station;
  toStation: Station;
  currentTime: Date;
  realtimeStatus?: TripRealtimeStatus | null;
  timeFormat: "12h" | "24h";
}

function nowMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

export function StopTimeline({
  trip,
  fromStation,
  toStation,
  currentTime,
  realtimeStatus,
  timeFormat,
}: StopTimelineProps) {
  const allStations = getAllStations();
  const fromIdx = stationIndexMap[fromStation];
  const toIdx = stationIndexMap[toStation];

  const minIdx = Math.min(fromIdx, toIdx);
  const maxIdx = Math.max(fromIdx, toIdx);

  // Slice stations and times for this route segment
  const stops = allStations.slice(minIdx, maxIdx + 1);
  const times = trip.times.slice(minIdx, maxIdx + 1);

  // If southbound, stops are in order; if northbound, reverse for display
  // (station list is Windsor→Larkspur = north→south, so southbound = forward)
  const isSouthbound = fromIdx < toIdx;
  const displayStops = isSouthbound ? stops : [...stops].reverse();
  const displayTimes = isSouthbound ? times : [...times].reverse();

  const hasRealtimeStopData = realtimeStatus?.hasRealtimeStopData ?? false;
  const allStopLiveDepartures = realtimeStatus?.allStopLiveDepartures;
  const now = nowMinutes();

  // Determine past/current using GTFS-RT live departure times when available,
  // falling back to static schedule times.
  //
  // GTFS-RT heuristic:
  //   - Stop IS in the feed with a past departure time → train has departed that stop
  //   - Stop IS in the feed with a future departure time → upcoming stop
  //   - Stop NOT in the feed but we have RT data for this trip → likely already served
  //   - No RT data at all → fall back to static schedule
  function getStopStatus(station: string, staticTime: string): "past" | "current" | "future" {
    const hasValidStaticTime = staticTime && staticTime !== "--" && staticTime !== "";

    if (hasRealtimeStopData && allStopLiveDepartures) {
      const liveTime = allStopLiveDepartures[station];
      if (liveTime) {
        // Stop is still in the feed — departure time tells us past/future
        return parseTimeToMinutes(liveTime) <= now ? "past" : "future";
      } else {
        // Stop is absent from the RT feed — train has already served it
        return "past";
      }
    }

    // Fallback: static schedule
    if (!hasValidStaticTime) return "future";
    return parseTimeToMinutes(staticTime) <= now ? "past" : "future";
  }

  // Compute statuses for all display stops
  const stopStatuses = displayStops.map((station, i) =>
    getStopStatus(station, displayTimes[i] ?? "")
  );

  // "Current" = last past stop (the train is between this stop and the next)
  // The train is AT this stop if it just departed, or approaching the next one
  let lastPastIdx = -1;
  for (let i = 0; i < stopStatuses.length; i++) {
    if (stopStatuses[i] === "past") lastPastIdx = i;
  }
  // currentStopDisplayIdx is the last stop the train has departed (or is at)
  const currentStopDisplayIdx = lastPastIdx;

  const isCanceled = realtimeStatus?.isCanceled ?? false;
  const isDelayed = !isCanceled && realtimeStatus?.delayMinutes != null;
  const delayMinutes = realtimeStatus?.delayMinutes;

  return (
    <div className="flex flex-col">
      {isDelayed && delayMinutes != null && (
        <p className="text-xs text-smart-gold mb-3 px-1">
          Running approximately {delayMinutes} min late
        </p>
      )}
      {isCanceled && (
        <p className="text-xs text-destructive mb-3 px-1">
          This trip has been canceled
        </p>
      )}
      {hasRealtimeStopData && !isCanceled && (
        <p className="text-xs text-muted-foreground mb-3 px-1">
          Live position from GTFS-RT
        </p>
      )}

      <div className="relative">
        {displayStops.map((station, i) => {
          const time = displayTimes[i];
          const hasTime = time && time !== "--" && time !== "";

          const isFrom = station === fromStation;
          const isTo = station === toStation;
          const isPast = currentStopDisplayIdx > i;
          const isCurrent = currentStopDisplayIdx === i;
          const isFirst = i === 0;
          const isLast = i === displayStops.length - 1;

          // Live time for this stop from GTFS-RT (if available and in the future)
          const liveStopTime = allStopLiveDepartures?.[station];
          const showLiveStopTime =
            liveStopTime && !isCanceled && hasTime &&
            liveStopTime !== time; // only show if different from scheduled

          // For the boarding stop: show live departure if delayed
          const showLiveFrom = isFrom && isDelayed && realtimeStatus?.liveDepartureTime;
          // For the arrival stop: show live arrival if delayed
          const showLiveTo = isTo && !isFrom && isDelayed && realtimeStatus?.liveArrivalTime;

          // "Boarding" label: only when train hasn't departed yet from this stop
          const isBoardingStop = isFrom && !isPast;
          // "Departed" label: train has left from stop
          const isDepartedStop = isFrom && isPast;

          return (
            <div key={station} className="flex items-start gap-3 relative">
              {/* Timeline line + icon column */}
              <div className="flex flex-col items-center w-5 shrink-0">
                {/* Line above */}
                <div
                  className={cn(
                    "w-px flex-1",
                    isFirst ? "invisible" : isPast ? "bg-muted-foreground/40" : "bg-border"
                  )}
                  style={{ minHeight: 8 }}
                />

                {/* Stop icon */}
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
                  // Glowing dot = estimated train position
                  <div className="h-3 w-3 rounded-full bg-smart-train-green shadow-[0_0_6px_2px_hsl(var(--smart-train-green)/0.4)] shrink-0" />
                ) : isPast ? (
                  <Circle className="h-3 w-3 text-muted-foreground/50 fill-muted-foreground/20 shrink-0" />
                ) : (
                  <Circle className="h-3 w-3 text-border shrink-0" />
                )}

                {/* Line below */}
                <div
                  className={cn(
                    "w-px flex-1",
                    isLast ? "invisible" : isPast || isCurrent ? "bg-muted-foreground/40" : "bg-border"
                  )}
                  style={{ minHeight: 8 }}
                />
              </div>

              {/* Station name + time */}
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
                    <span className="text-xs text-smart-train-green/80">Boarding</span>
                  )}
                  {isDepartedStop && (
                    <span className="text-xs text-muted-foreground">Departed</span>
                  )}
                  {isTo && !isFrom && (
                    <span className="text-xs text-primary/80">Arriving</span>
                  )}
                </div>

                {/* Times column */}
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
                            showLiveStopTime ? "text-xs line-through text-muted-foreground" : "text-sm",
                            !showLiveStopTime && (
                              isCanceled
                                ? "line-through text-destructive"
                                : isFrom && !isPast
                                ? "text-smart-train-green"
                                : isPast
                                ? "text-muted-foreground"
                                : "text-foreground"
                            )
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
