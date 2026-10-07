import { useLocation, useNavigate } from "react-router-dom";
import { ChevronRight, GitCommitVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useNow } from "@/hooks/useNow";
import { warmMapDiagram } from "@/pages/lazyPages";
import { resolveLegPosition, type LegPosition } from "@/lib/legProgress";
import { isSouthbound } from "@/lib/stationUtils";
import { minutesOfDay } from "@/lib/timeUtils";
import { scheduledStationIndex } from "@/lib/trainMotion";
import { effectiveDelayMinutes } from "@/lib/tripDelay";
import { AT_STOP_THRESHOLD_MI } from "@/lib/tripConstants";
import { SectionCard } from "@/components/ui/section-card";
import { TripIcon } from "./icons/TripIcon";
import { TimeDisplay } from "./TimeDisplay";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripProgressResult } from "@/hooks/useTripProgress";
import type { TripDetailModel } from "@/hooks/useTripDetailModel";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";

/** Width (% of the track) of the dashed lead-in before the origin — where a
 *  train that hasn't reached the rider's station yet is drawn. */
const LEAD_IN_PCT = 14;
/** Stops upstream that the lead-in spans; a train farther out sits at its tip. */
const LEAD_IN_STOPS = 3;
const LEG_SPAN_PCT = 100 - LEAD_IN_PCT;
const MILES_PRECISION = 1;

/** Where the train marker sits, as % of the track width (null: not drawn). */
function markerPctFor(position: LegPosition): number | null {
  switch (position.phase) {
    case "arrived":
      return 100;
    case "enRoute":
      return LEAD_IN_PCT + LEG_SPAN_PCT * position.fraction;
    case "atOrigin":
      return LEAD_IN_PCT;
    case "approaching":
      return (
        LEAD_IN_PCT *
        (1 - Math.min(position.stopsAway, LEAD_IN_STOPS) / LEAD_IN_STOPS)
      );
    case "waiting":
      return null;
  }
}

/** "Live · 12s ago" — its own component so the 5s tick re-renders only this
 *  label, not the whole card. */
function LiveAgo({ timestamp }: { timestamp: number }) {
  const { t } = useTranslation();
  const nowSec = useNow(5_000);
  const ageSec = Math.max(0, nowSec - Math.floor(timestamp));
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-smart-train-green">
      <span
        className="inline-flex h-2 w-2 rounded-full bg-smart-train-green"
        aria-hidden="true"
      />
      {ageSec >= 5 ? t("myTrip.liveAgo", { seconds: ageSec }) : t("myTrip.live")}
    </span>
  );
}

interface TripPositionCardProps {
  trip: ProcessedTrip;
  fromStation: Station;
  toStation: Station;
  realtimeStatus: TripRealtimeStatus | null;
  /** The clock the trip is evaluated against (see useMyTripState). */
  clockTime: Date;
  progress: TripProgressResult;
  model: TripDetailModel;
  /** The "my trip" accent background (blue / gold / neutral). */
  accentBg: string;
  timeFormat: "12h" | "24h";
}

/**
 * "Where's my train?" — a horizontal track of the rider's leg with the train
 * drawn on it: upstream of the origin while it's on its way to pick them up,
 * along the leg while they ride, at the end once they've arrived. Uses the live
 * GPS fix when the vehicle feed has one, else the timetable (marked as an
 * estimate). Links to the live line map for the whole-corridor picture.
 */
export function TripPositionCard({
  trip,
  fromStation,
  toStation,
  realtimeStatus,
  clockTime,
  progress,
  model,
  accentBg,
  timeFormat,
}: TripPositionCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const vehicle = progress.vehiclePosition;
  const { displayStops, hasStarted } = progress.stopInference;

  const position = resolveLegPosition({
    fromStation,
    toStation,
    vehicle,
    scheduleIndex: scheduledStationIndex(
      trip,
      isSouthbound(fromStation, toStation) ? "S" : "N",
      minutesOfDay(clockTime),
      effectiveDelayMinutes(realtimeStatus) ?? 0,
    ),
    departed: hasStarted,
    arrived: progress.isEnded || model.isAtDestination,
  });

  const markerPct = markerPctFor(position);
  const filledPct =
    markerPct == null ? 0 : Math.max(0, markerPct - LEAD_IN_PCT);
  const isEstimate =
    position.phase === "enRoute" && position.source === "schedule";
  const showLive = vehicle != null && position.phase !== "arrived";

  // ── Copy ──────────────────────────────────────────────────────────────────
  const miles = (mi: number) =>
    t("myTrip.miles", { distance: mi.toFixed(MILES_PRECISION) });
  let headline: string;
  let details: string[] = [];
  switch (position.phase) {
    case "arrived":
      headline = t("myTrip.arrivedAt", { station: toStation });
      break;
    case "atOrigin":
      headline = t("myTrip.trainAt", { station: fromStation });
      break;
    case "approaching":
      headline = position.stopped
        ? t("myTrip.trainAt", { station: position.station })
        : t("myTrip.trainHeadingTo", { station: position.station });
      details = [t("myTrip.stopsAway", { count: position.stopsAway })];
      if (position.distanceMi != null) details.push(miles(position.distanceMi));
      break;
    case "enRoute": {
      const stop = progress.nextStop;
      const distanceMi = progress.distanceToNextStopMi;
      const atStop = distanceMi != null && distanceMi < AT_STOP_THRESHOLD_MI;
      headline = !stop
        ? t("tracker.onTheWay")
        : atStop
          ? t("tracker.atStop", { stop })
          : t("myTrip.nextStop", { station: stop });
      if (!atStop && distanceMi != null) details.push(miles(distanceMi));
      if (model.speedMph != null) {
        details.push(t("tracker.speedMph", { speed: model.speedMph }));
      }
      break;
    }
    case "waiting":
      headline = t("myTrip.positionWaiting");
      break;
  }

  return (
    <SectionCard
      className="p-4 md:p-5"
      aria-label={t("myTrip.positionTitle")}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("myTrip.positionTitle")}
        </h2>
        {showLive ? (
          <LiveAgo timestamp={vehicle.timestamp} />
        ) : isEstimate ? (
          <span className="text-xs text-muted-foreground">
            {t("myTrip.estimated")}
          </span>
        ) : null}
      </div>

      <p className="mt-2 text-lg font-semibold leading-snug">{headline}</p>
      {details.length > 0 && (
        <p className="text-sm text-muted-foreground">{details.join(" · ")}</p>
      )}

      {/* The track. Stops are evenly spaced in station-index space — the same
          schematic the line map uses — so the train lands between the right
          dots. */}
      <div className="mt-5 px-2">
        <div className="relative h-8">
          {/* Lead-in: the line coming from upstream stations. */}
          <div
            className="absolute top-1/2 -translate-y-1/2 border-t-2 border-dashed border-muted-foreground/30"
            style={{ left: 0, width: `${LEAD_IN_PCT}%` }}
            aria-hidden="true"
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 h-1 rounded-full bg-muted"
            style={{ left: `${LEAD_IN_PCT}%`, right: 0 }}
            aria-hidden="true"
          />
          <div
            className={cn(
              "absolute top-1/2 -translate-y-1/2 h-1 rounded-full transition-[width] duration-1000 ease-out motion-reduce:transition-none",
              accentBg,
              isEstimate && "opacity-60",
            )}
            style={{ left: `${LEAD_IN_PCT}%`, width: `${filledPct}%` }}
            aria-hidden="true"
          />
          {displayStops.map((station, i) => {
            const pct =
              LEAD_IN_PCT +
              (displayStops.length > 1
                ? (LEG_SPAN_PCT * i) / (displayStops.length - 1)
                : 0);
            const isEndpoint = i === 0 || i === displayStops.length - 1;
            const passed = markerPct != null && pct <= markerPct + 0.01;
            return (
              <span
                key={station}
                className={cn(
                  "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card",
                  isEndpoint ? "h-3.5 w-3.5" : "h-2 w-2",
                  passed
                    ? accentBg
                    : isEndpoint
                      ? "bg-foreground/70"
                      : "bg-muted-foreground/40",
                )}
                style={{ left: `${pct}%` }}
                title={station}
                aria-hidden="true"
              />
            );
          })}
          {markerPct != null && (
            <span
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-[left] duration-1000 ease-out motion-reduce:transition-none"
              style={{ left: `${markerPct}%` }}
              aria-hidden="true"
            >
              {/* A brief pulse on each fresh GPS fix (re-keyed per report),
                  rather than an endless animation on a screen left open for
                  the whole ride. */}
              {showLive && (
                <span
                  key={vehicle.timestamp}
                  className={cn(
                    "absolute inset-0 rounded-full opacity-40 animate-ping motion-reduce:animate-none",
                    accentBg,
                  )}
                  style={{ animationIterationCount: 2 }}
                />
              )}
              <span
                className={cn(
                  "relative flex h-8 w-8 items-center justify-center rounded-full text-white shadow-md ring-[3px] ring-card",
                  accentBg,
                  isEstimate && "opacity-75",
                )}
              >
                <TripIcon className="h-4 w-4" />
              </span>
            </span>
          )}
        </div>

        {/* Endpoint labels + live-aware times, aligned under the dots. */}
        <div className="mt-2 flex justify-between gap-3 text-xs">
          {/* Start the origin label at its dot's left edge (the endpoint dot
              is 14px wide). */}
          <div
            className="min-w-0"
            style={{ paddingLeft: `calc(${LEAD_IN_PCT}% - 7px)` }}
          >
            <p className="truncate font-medium">{fromStation}</p>
            <TimeDisplay
              time={model.departureTime}
              format={timeFormat}
              className="text-muted-foreground"
            />
          </div>
          <div className="min-w-0 text-right">
            <p className="truncate font-medium">{toStation}</p>
            <TimeDisplay
              time={model.arrivalTime}
              format={timeFormat}
              className="text-muted-foreground"
            />
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() =>
          navigate({ pathname: "/map-diagram", search: location.search })
        }
        onPointerEnter={warmMapDiagram}
        onFocus={warmMapDiagram}
        className="mt-4 -mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm font-medium text-smart-train-green transition-colors hover:bg-smart-train-green/10"
      >
        <span className="flex items-center gap-2">
          <GitCommitVertical className="h-4 w-4" aria-hidden="true" />
          {t("myTrip.viewOnLineMap")}
        </span>
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </SectionCard>
  );
}
