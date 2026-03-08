import { cn } from "@/lib/utils";
import {
  stationIndexMap,
  getAllStations,
  getClosestStationWithDistance,
} from "@/lib/stationUtils";
import { parseTimeToMinutes } from "@/lib/timeUtils";
import { TimeDisplay } from "./TimeDisplay";
import { TripIcon } from "@/components/icons/TripIcon";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";
import { Circle, CornerDownRight, MapPin } from "lucide-react";
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

  return (
    <div className="flex flex-col">
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

          // Per-stop delay in minutes
          const perStopDelayMin =
            showLiveStopTime
              ? parseTimeToMinutes(liveStopTime!) - parseTimeToMinutes(time)
              : 0;
          const hasPerStopDelay = perStopDelayMin > 0 && !isPast;

          // Which time to display (live if available)
          const showLiveFrom = isFrom && realtimeStatus?.liveDepartureTime;
          const showLiveTo = isTo && !isFrom && realtimeStatus?.liveArrivalTime;

          // Status pills
          const isBoardingStop = isFrom && !isPast;
          const isDepartedStop = isFrom && isPast;

          // Row accent colour drives both station name and time colour
          type Accent = "green" | "gold" | "muted" | "destructive" | "default";
          const accent: Accent = isCanceled
            ? "destructive"
            : isCurrent || isTo
            ? "green"
            : hasPerStopDelay
            ? "gold"
            : isPast
            ? "muted"
            : "default";

          const accentText: Record<Accent, string> = {
            green: "text-smart-train-green",
            gold: "text-smart-gold",
            muted: "text-muted-foreground/50",
            destructive: "text-destructive",
            default: "text-foreground",
          };

          // Pill shown to the right of station name
          type Pill = { label: string; cls: string } | null;
          const pill: Pill = isBoardingStop
            ? { label: t("tracker.boarding"), cls: "bg-smart-train-green text-white" }
            : isDepartedStop
            ? { label: t("tracker.departed"), cls: "bg-muted-foreground/40 text-white" }
            : isTo && !isFrom
            ? { label: t("tracker.arriving"), cls: "bg-primary text-white" }
            : hasPerStopDelay
            ? {
                label: t("tripCard.delayed", { minutes: perStopDelayMin }),
                cls: "bg-smart-gold text-white",
              }
            : null;

          // Stop-point icon (right sub-column): origin pin, destination arrow, or dot
          const stopIcon = isFrom ? (
            <MapPin
              className={cn(
                "h-4 w-4 shrink-0",
                isCanceled
                  ? "text-destructive"
                  : isPast
                  ? "text-muted-foreground/40"
                  : "text-smart-train-green"
              )}
            />
          ) : isTo ? (
            <CornerDownRight
              className={cn(
                "h-4 w-4 shrink-0",
                isCanceled ? "text-destructive" : "text-primary"
              )}
              style={{ strokeWidth: 3 }}
            />
          ) : isPast ? (
            <Circle className="h-2.5 w-2.5 text-muted-foreground/30 fill-muted-foreground/20 shrink-0" />
          ) : (
            <Circle className="h-2.5 w-2.5 text-border shrink-0" />
          );

          // Connector line colour
          const lineAbove = isFirst
            ? "invisible"
            : isPast
            ? "bg-muted-foreground/30"
            : "bg-border";
          const lineBelow = isLast
            ? "invisible"
            : isPast || isCurrent
            ? "bg-muted-foreground/30"
            : "bg-border";

          return (
            <div
              key={station}
              className={cn(
                "flex items-center gap-3 relative",
                isCurrent && "bg-smart-train-green/10 rounded-lg"
              )}
            >
              {/*
                Icon column — total w-[5rem] split into two sub-columns:
                  Left  (~w-6): train position indicator — TripIcon when current, empty otherwise
                  Right (flex-1): stop-point with vertical connector line
                gap-3 between this column and text mirrors header badge→text spacing
              */}
              <div className="flex self-stretch shrink-0 w-[5rem]">
                {/* Left sub-column: train position */}
                <div className="flex items-center justify-center w-6 shrink-0">
                  {isCurrent && (
                    <TripIcon className="h-4 w-4 text-smart-train-green" />
                  )}
                </div>
                {/* Right sub-column: vertical connector + stop icon */}
                <div className="flex flex-col items-center flex-1">
                  <div className={cn("w-px flex-1", lineAbove)} style={{ minHeight: 6 }} />
                  {stopIcon}
                  <div className={cn("w-px flex-1", lineBelow)} style={{ minHeight: 6 }} />
                </div>
              </div>

              {/* Row content */}
              <div className="flex items-center flex-1 py-2.5 pr-3 gap-2 min-w-0">
                {/* Station name */}
                <span
                  className={cn(
                    "text-sm flex-1 min-w-0 truncate",
                    (isCurrent || isTo || (isFrom && !isPast)) && "font-semibold",
                    isCanceled ? "line-through" : "",
                    accentText[accent]
                  )}
                >
                  {station}
                </span>

                {/* Pill */}
                {pill && (
                  <span
                    className={cn(
                      "text-xs font-medium px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap",
                      pill.cls
                    )}
                  >
                    {pill.label}
                  </span>
                )}

                {/* Time */}
                {hasTime && (
                  <div className="shrink-0">
                    {showLiveFrom ? (
                      <TimeDisplay
                        time={realtimeStatus!.liveDepartureTime!}
                        format={timeFormat}
                        className={cn("text-sm", accentText[accent])}
                      />
                    ) : showLiveTo ? (
                      <TimeDisplay
                        time={realtimeStatus!.liveArrivalTime!}
                        format={timeFormat}
                        className={cn("text-sm", accentText[accent])}
                      />
                    ) : showLiveStopTime ? (
                      <TimeDisplay
                        time={liveStopTime!}
                        format={timeFormat}
                        className={cn("text-sm", accentText[accent])}
                      />
                    ) : (
                      <TimeDisplay
                        time={time}
                        format={timeFormat}
                        className={cn(
                          "text-sm",
                          isCanceled ? "line-through" : "",
                          accentText[accent]
                        )}
                      />
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
