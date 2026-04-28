import { cn } from "@/lib/utils";
import { TimeDisplay } from "./TimeDisplay";
import { TripIcon } from "@/components/icons/TripIcon";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";
import { Circle, CircleDot, CornerDownRight, MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { StopInferenceResult } from "@/hooks/useStopInference";
import {
  type TripState,
  stateText,
  stateIconText,
  stateTint,
  stateLineColor,
  stateBg,
} from "@/lib/tripTheme";

interface StopTimelineProps {
  trip: ProcessedTrip;
  fromStation: Station;
  toStation: Station;
  realtimeStatus?: TripRealtimeStatus | null;
  timeFormat: "12h" | "24h";
  /** When true all stops are rendered as past/muted — used for the ended state. */
  isEnded?: boolean;
  /** Pre-computed stop inference results from useTripProgress. */
  stopInference: StopInferenceResult;
  /** The user's selected origin (from URL/schedule). When set and distinct
   *  from the displayed leg's endpoints, the matching intermediate row gets
   *  the dot-with-outline marker that the line diagram uses to mark
   *  selected stations — same vocabulary in both surfaces. */
  userFromStation?: Station | null;
  /** The user's selected destination (from URL/schedule). See userFromStation. */
  userToStation?: Station | null;
}

export function StopTimeline({
  trip,
  fromStation,
  toStation,
  realtimeStatus,
  timeFormat,
  isEnded = false,
  stopInference,
  userFromStation = null,
  userToStation = null,
}: StopTimelineProps) {
  const { t } = useTranslation();
  void trip;

  const {
    displayStops,
    displayTimes,
    statusByStop,
    states: inferredStates,
  } = stopInference;

  const allStopDelayMinutes = realtimeStatus?.allStopDelayMinutes;
  const isCanceled = realtimeStatus?.isCanceled ?? false;

  // When the trip has ended all stops are forced to "past" so nothing stays highlighted.
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

          // Per-stop semantic state — drives all colours for this row
          const accent: TripState = isCanceled
            ? "canceled"
            : hasPerStopDelay
            ? "delayed"
            : isCurrent
            ? "ontime"
            : isPast
            ? "past"
            : "future";

          // Delay pill
          const pill = hasPerStopDelay
            ? {
                label: t("tripCard.delayed", { minutes: perStopDelayMin }),
                cls: cn(stateBg["delayed"], "text-white"),
              }
            : null;

          // Stop-point icon — uses theme maps so colours stay in sync with text
          const endpointIconColor = isCurrent
            ? stateText[accent]
            : isPast
            ? stateIconText["past"]
            : stateIconText["future"];

          // Mark the user's selected from/to with a ring-and-dot, matching
          // the line diagram's selected-station treatment. Skip when the
          // station is already the displayed leg's start/end (which carry
          // the MapPin / CornerDownRight icons). When it coincides with
          // the currently-served stop the ring-and-dot wins over the
          // filled-disc; color follows the row's accent so the current
          // stop reads green-on-time, gold-on-delay, etc.
          const isUserSelected =
            !isFrom &&
            !isTo &&
            (station === userFromStation || station === userToStation);

          const stopIcon = isFrom ? (
            <MapPin
              className={cn("h-5 w-5", endpointIconColor)}
              style={{ marginBottom: -1 }}
              strokeWidth={1.5}
            />
          ) : isTo ? (
            <CornerDownRight
              className={cn("h-4 w-4", endpointIconColor)}
              style={{ marginLeft: 11, marginTop: -3 }}
              strokeWidth={1.5}
            />
          ) : isUserSelected ? (
            // Selected stop should pop a touch louder than the muted
            // intermediate dots: use stateText (fuller opacity for past /
            // future) instead of stateIconText, plus a slightly larger
            // glyph and thicker stroke. Brand colors for on-time / delayed
            // / canceled are unchanged because both maps share them.
            // strokeWidth applied via style to defeat any inherited CSS.
            <CircleDot
              className={cn("h-4 w-4 shrink-0", stateText[accent])}
              style={{ strokeWidth: 3 }}
            />
          ) : (
            <Circle
              className={cn(
                "h-2.5 w-2.5 shrink-0",
                stateIconText[accent],
                isCurrent ? "fill-current" : "fill-transparent",
              )}
            />
          );

          // Connector lines
          const lineAbove = isFirst
            ? "invisible"
            : isPast || isCurrent
            ? stateLineColor["past"]
            : stateLineColor["future"];
          const lineBelow = isLast
            ? "invisible"
            : isPast
            ? stateLineColor["past"]
            : stateLineColor["future"];

          // Unused but kept to satisfy the destructuring from statusByStop
          void staticTime;

          return (
            <div
              key={station}
              className={cn(
                "flex items-center gap-3 relative",
                isCurrent && "rounded-lg",
                isCurrent && stateTint[accent],
              )}
            >
              {/*
                Icon column — total w-[5rem] split into two sub-columns:
                  Left  (~w-6): train position indicator
                  Right (flex-1): stop-point with vertical connector line
              */}
              <div className="flex self-stretch shrink-0 w-[5rem]">
                <div className="flex items-center justify-end w-8 shrink-0">
                  {isCurrent && (
                    <TripIcon
                      className={cn("h-4 w-4", stateText[accent])}
                    />
                  )}
                </div>
                <div className="flex flex-col items-center flex-1">
                  <div
                    className={cn("w-px flex-1", lineAbove)}
                    style={{ minHeight: 6 }}
                  />
                  {stopIcon}
                  <div
                    className={cn("w-px flex-1", lineBelow)}
                    style={{ minHeight: 6 }}
                  />
                </div>
              </div>

              {/* Row content */}
              <div className="flex items-center flex-1 py-1.5 pr-3 gap-2 min-w-0">
                <span
                  className={cn(
                    "text-sm flex-1 min-w-0 truncate",
                    (isCurrent || isTo || (isFrom && !isPast)) && "font-semibold",
                    isCanceled && "line-through",
                    stateText[accent],
                  )}
                >
                  {station}
                </span>

                {pill && (
                  <span
                    className={cn(
                      "text-xs font-medium px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap",
                      pill.cls,
                    )}
                  >
                    {pill.label}
                  </span>
                )}

                {hasTime && (
                  <div className="shrink-0">
                    {showLiveFrom ? (
                      <TimeDisplay
                        time={realtimeStatus!.liveDepartureTime!}
                        format={timeFormat}
                        className={cn("text-sm", stateText[accent])}
                      />
                    ) : showLiveTo ? (
                      <TimeDisplay
                        time={realtimeStatus!.liveArrivalTime!}
                        format={timeFormat}
                        className={cn("text-sm", stateText[accent])}
                      />
                    ) : showLiveStopTime ? (
                      <TimeDisplay
                        time={liveStopTime!}
                        format={timeFormat}
                        className={cn("text-sm", stateText[accent])}
                      />
                    ) : (
                      <TimeDisplay
                        time={time}
                        format={timeFormat}
                        className={cn(
                          "text-sm",
                          isCanceled && "line-through",
                          stateText[accent],
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
