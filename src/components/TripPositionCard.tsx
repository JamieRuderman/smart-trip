import { useLocation, useNavigate } from "react-router-dom";
import { ChevronRight, GitCommitVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useNow } from "@/hooks/useNow";
import { warmMapDiagram } from "@/pages/lazyPages";
import { resolveLegPosition, type LegPosition } from "@/lib/legProgress";
import { isSouthbound, stationTrackColor } from "@/lib/stationUtils";
import { minutesOfDay } from "@/lib/timeUtils";
import { scheduledStationIndex } from "@/lib/trainMotion";
import { effectiveDelayMinutes } from "@/lib/tripDelay";
import { AT_STOP_THRESHOLD_MI } from "@/lib/tripConstants";
import { BRAND_LINE_COLOR } from "@/data/smartLineLayout";
import { SectionCard } from "@/components/ui/section-card";
import { TOKEN } from "./SmartLineDiagram/tokens";
import { TrainGlyph } from "./SmartLineDiagram/TrainGlyph";
import { TimeDisplay } from "./TimeDisplay";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripProgressResult } from "@/hooks/useTripProgress";
import type { TripDetailModel } from "@/hooks/useTripDetailModel";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";

/** Width (% of the track) of the lead-in before the origin — where a train
 *  that hasn't reached the rider's station yet is drawn. */
const LEAD_IN_PCT = 14;
/** Stops upstream that the lead-in spans; a train farther out sits at its tip. */
const LEAD_IN_STOPS = 3;
const LEG_SPAN_PCT = 100 - LEAD_IN_PCT;
const MILES_PRECISION = 1;

// The track mirrors the line map's look, scaled to the card: a muted line
// beyond the leg, the whole leg in its fare-zone colors, hollow station rings
// (the rider's two stations enlarged with a filled core) and the map's train
// marker, whose place on the line shows how far along the trip is.
const TRACK_PX = 6;
const STOP_DOT_PX = 12;
const ENDPOINT_DOT_PX = 16;
/** Card px per line-map viewBox unit for the train marker. */
const MARKER_SCALE = 0.68;
/** Half-size, in map units, of the box holding the marker's halo and pointer. */
const MARKER_BOX_R = TOKEN.trainPulseRMax;
const MARKER_BOX_PX = 2 * MARKER_BOX_R * MARKER_SCALE;
/** The marker disc's outer diameter, for the GPS-fix ping. */
const MARKER_DISC_PX =
  (2 * TOKEN.trainInnerR + TOKEN.trainStroke) * MARKER_SCALE;

/** The leg's zone colors as a hard-stop gradient across its width: each stop
 *  owns the track halfway to its neighbors, as on the line map. */
function zoneGradient(stops: Station[]): string {
  if (stops.length === 0) return BRAND_LINE_COLOR;
  const last = stops.length - 1;
  const bands = stops.map((station, i) => {
    const start = i === 0 ? 0 : ((i - 0.5) / last) * 100;
    const end = i === last ? 100 : ((i + 0.5) / last) * 100;
    return `${stationTrackColor(station)} ${start}% ${end}%`;
  });
  return `linear-gradient(to right, ${bands.join(", ")})`;
}

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
  /** The My Trip accent as a color (see useMyTripState) — the train's. */
  accentColor: string;
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
  accentColor,
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
  const legGradient = zoneGradient(displayStops);
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
          dots. Inset enough (with the card's padding) that the train's pointer,
          27px ahead of a marker at either end, stays inside the card. */}
      <div className="mt-5 px-3">
        <div className="relative h-10">
          {/* Lead-in: the line coming from upstream stations, in the map's
              muted track color, fading out. */}
          <div
            className="absolute top-1/2 -translate-y-1/2"
            style={{
              left: 0,
              width: `${LEAD_IN_PCT}%`,
              height: TRACK_PX,
              background: `linear-gradient(to right, transparent, ${TOKEN.mutedTrack} 70%)`,
            }}
            aria-hidden="true"
          />
          {/* The leg, in its fare zones' colors. */}
          <div
            className="absolute top-1/2 -translate-y-1/2"
            style={{
              left: `${LEAD_IN_PCT}%`,
              right: 0,
              height: TRACK_PX,
              background: legGradient,
            }}
            aria-hidden="true"
          />
          {displayStops.map((station, i) => {
            const pct =
              LEAD_IN_PCT +
              (displayStops.length > 1
                ? (LEG_SPAN_PCT * i) / (displayStops.length - 1)
                : 0);
            const isEndpoint = i === 0 || i === displayStops.length - 1;
            const color = stationTrackColor(station);
            const size = isEndpoint ? ENDPOINT_DOT_PX : STOP_DOT_PX;
            // The map's station geometry (stroke-centered radius + stroke)
            // scaled so the ring's outer edge is `size` across.
            const r = isEndpoint ? TOKEN.terminalR : TOKEN.stationR;
            const unit = size / (2 * r + TOKEN.stationStroke);
            return (
              <span
                key={station}
                className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-card"
                style={{
                  left: `${pct}%`,
                  width: size,
                  height: size,
                  border: `${TOKEN.stationStroke * unit}px solid ${color}`,
                }}
                title={station}
                aria-hidden="true"
              >
                {isEndpoint && (
                  <span
                    className="rounded-full"
                    style={{
                      width: 2 * r * TOKEN.terminalCoreRatio * unit,
                      height: 2 * r * TOKEN.terminalCoreRatio * unit,
                      backgroundColor: color,
                    }}
                  />
                )}
              </span>
            );
          })}
          {markerPct != null && (
            <span
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-[left] duration-1000 ease-out motion-reduce:transition-none"
              style={{
                left: `${markerPct}%`,
                width: MARKER_BOX_PX,
                height: MARKER_BOX_PX,
              }}
              aria-hidden="true"
            >
              {/* A brief pulse on each fresh GPS fix (re-keyed per report),
                  rather than an endless animation on a screen left open for
                  the whole ride. Inset, not translated, so the ping's own
                  transform doesn't knock it off center. */}
              {showLive && (
                <span
                  key={vehicle.timestamp}
                  className="absolute rounded-full opacity-40 animate-ping motion-reduce:animate-none"
                  style={{
                    inset: (MARKER_BOX_PX - MARKER_DISC_PX) / 2,
                    backgroundColor: accentColor,
                    animationIterationCount: 2,
                  }}
                />
              )}
              {/* The line map's marker, its halo still; the rider's leg always
                  runs left to right here. */}
              <svg
                className={cn(
                  "absolute inset-0 overflow-visible",
                  isEstimate && "opacity-75",
                )}
                width={MARKER_BOX_PX}
                height={MARKER_BOX_PX}
                viewBox={`${-MARKER_BOX_R} ${-MARKER_BOX_R} ${2 * MARKER_BOX_R} ${2 * MARKER_BOX_R}`}
              >
                <TrainGlyph
                  accent={accentColor}
                  label={String(trip.trip)}
                  bearing={90}
                  fill="hsl(var(--card))"
                  pulse={false}
                />
              </svg>
            </span>
          )}
        </div>

        {/* Endpoint labels + live-aware times, aligned under the dots. */}
        <div className="mt-2 flex justify-between gap-3 text-xs">
          {/* Start the origin label at its dot's left edge. */}
          <div
            className="min-w-0"
            style={{ paddingLeft: `calc(${LEAD_IN_PCT}% - ${ENDPOINT_DOT_PX / 2}px)` }}
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
