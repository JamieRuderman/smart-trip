import { cn } from "@/lib/utils";
import { parseTimeToMinutes } from "@/lib/timeUtils";
import { TimeDisplay } from "./TimeDisplay";
import { TripIcon } from "@/components/icons/TripIcon";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";
import { Circle, CornerDownRight, MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStopInference, type StopAccent } from "@/hooks/useStopInference";

interface StopTimelineProps {
  trip: ProcessedTrip;
  fromStation: Station;
  toStation: Station;
  currentTime: Date;
  realtimeStatus?: TripRealtimeStatus | null;
  timeFormat: "12h" | "24h";
  currentLat?: number | null;
  currentLng?: number | null;
  /** When true all stops are rendered as past/muted — used for the ended state. */
  isEnded?: boolean;
}

const accentText: Record<StopAccent, string> = {
  green: "text-smart-train-green",
  gold: "text-smart-gold",
  muted: "text-muted-foreground/50",
  destructive: "text-destructive",
  default: "text-foreground",
};

export function StopTimeline({
  trip,
  fromStation,
  toStation,
  currentTime,
  realtimeStatus,
  timeFormat,
  currentLat,
  currentLng,
  isEnded = false,
}: StopTimelineProps) {
  const { t } = useTranslation();

  const { displayStops, displayTimes, statusByStop, states: inferredStates } = useStopInference({
    trip,
    fromStation,
    toStation,
    currentTime,
    realtimeStatus,
    currentLat,
    currentLng,
  });

  const allStopLiveDepartures = realtimeStatus?.allStopLiveDepartures;
  const allStopDelayMinutes = realtimeStatus?.allStopDelayMinutes;
  const isCanceled = realtimeStatus?.isCanceled ?? false;

  // When the trip has ended all stops are forced to "past" so nothing stays green.
  const states = isEnded
    ? inferredStates.map(() => "past" as const)
    : inferredStates;

  return (
    <div className="flex flex-col">
      <div className="relative">
        {displayStops.map((station, i) => {
          const time = displayTimes[i];
          const hasTime = time && time !== "--" && time !== "";

          const isFrom = station === fromStation;
          const isTo = station === toStation;
          const state = states[i];
          const isPast = state === "past";
          const isCurrent = state === "current";
          const isFirst = i === 0;
          const isLast = i === displayStops.length - 1;

          const { liveTime: liveStopTime, staticTime } = statusByStop[i];
          const showLiveStopTime =
            liveStopTime && !isCanceled && hasTime && liveStopTime !== time;

          const perStopDelayMin = allStopDelayMinutes?.[station] ?? 0;
          const hasPerStopDelay = perStopDelayMin > 0 && !isPast;

          const showLiveFrom = isFrom && realtimeStatus?.liveDepartureTime;
          const showLiveTo = isTo && !isFrom && realtimeStatus?.liveArrivalTime;

          // Row accent — same logic as useStopInference but scoped per stop
          const accent: StopAccent = isCanceled
            ? "destructive"
            : hasPerStopDelay
            ? "gold"
            : isCurrent
            ? "green"
            : isPast
            ? "muted"
            : "default";

          // Delay pill
          const pill =
            hasPerStopDelay
              ? { label: t("tripCard.delayed", { minutes: perStopDelayMin }), cls: "bg-smart-gold text-white" }
              : null;

          // Stop-point icon
          const stopIcon = isFrom ? (
            <MapPin
              className={cn(
                "h-4 w-4 shrink-0",
                isCanceled
                  ? "text-destructive"
                  : isPast
                  ? "text-muted-foreground/40"
                  : accent === "gold"
                  ? "text-smart-gold"
                  : "text-smart-train-green"
              )}
            />
          ) : isTo ? (
            <CornerDownRight
              className={cn(
                "h-4 w-4 shrink-0",
                isCanceled
                  ? "text-destructive"
                  : isPast
                  ? "text-muted-foreground/40"
                  : isCurrent
                  ? accentText[accent]
                  : "text-muted-foreground/40"
              )}
              style={{ strokeWidth: 3 }}
            />
          ) : isPast ? (
            <Circle className="h-2.5 w-2.5 text-muted-foreground/30 fill-muted-foreground/20 shrink-0" />
          ) : (
            <Circle className="h-2.5 w-2.5 text-border shrink-0" />
          );

          // Connector lines
          const lineAbove = isFirst ? "invisible" : isPast ? "bg-muted-foreground/30" : "bg-border";
          const lineBelow = isLast ? "invisible" : isPast || isCurrent ? "bg-muted-foreground/30" : "bg-border";

          // Unused but kept to satisfy the destructuring from statusByStop
          void staticTime;

          return (
            <div
              key={station}
              className={cn(
                "flex items-center gap-3 relative",
                isCurrent && accent === "gold"
                  ? "bg-smart-gold/10 rounded-lg"
                  : isCurrent
                  ? "bg-smart-train-green/10 rounded-lg"
                  : ""
              )}
            >
              {/*
                Icon column — total w-[5rem] split into two sub-columns:
                  Left  (~w-6): train position indicator
                  Right (flex-1): stop-point with vertical connector line
              */}
              <div className="flex self-stretch shrink-0 w-[5rem]">
                <div className="flex items-center justify-end w-6 shrink-0">
                  {isCurrent && (
                    <TripIcon
                      className={cn(
                        "h-4 w-4",
                        accent === "gold" ? "text-smart-gold" : "text-smart-train-green"
                      )}
                    />
                  )}
                </div>
                <div className="flex flex-col items-center flex-1">
                  <div className={cn("w-px flex-1", lineAbove)} style={{ minHeight: 6 }} />
                  {stopIcon}
                  <div className={cn("w-px flex-1", lineBelow)} style={{ minHeight: 6 }} />
                </div>
              </div>

              {/* Row content */}
              <div className="flex items-center flex-1 py-1.5 pr-3 gap-2 min-w-0">
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

                {pill && (
                  <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap", pill.cls)}>
                    {pill.label}
                  </span>
                )}

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
                        className={cn("text-sm", isCanceled ? "line-through" : "", accentText[accent])}
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
