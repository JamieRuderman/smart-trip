import { useLocation, useNavigate } from "react-router-dom";
import { ChevronRight, GitCommitVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useNow } from "@/hooks/useNow";
import { warmMapDiagram } from "@/pages/lazyPages";
import { resolveLegPosition, type LegPosition } from "@/lib/legProgress";
import { isSouthbound, stationZoneMap } from "@/lib/stationUtils";
import { minutesOfDay } from "@/lib/timeUtils";
import { scheduledStationIndex } from "@/lib/trainMotion";
import { effectiveDelayMinutes } from "@/lib/tripDelay";
import { AT_STOP_THRESHOLD_MI } from "@/lib/tripConstants";
import { BRAND_LINE_COLOR, ZONE_TRACK_COLORS } from "@/data/smartLineLayout";
import { SectionCard } from "@/components/ui/section-card";
import { TOKEN, TRAIN_COLORS } from "./SmartLineDiagram/tokens";
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

// The track mirrors the line map's look, scaled to the card: a muted line
// beyond the leg, the whole leg in its fare-zone colors, hollow station rings
// (the rider's two stations enlarged with a filled core) and the map's train
// marker, whose place on the line shows how far along the trip is.
const TRACK_PX = 6;
const STOP_DOT_PX = 12;
const ENDPOINT_DOT_PX = 16;
const MARKER_PX = 32;
/** The map's halo radius relative to its marker's outer edge. */
const HALO_SCALE =
  TOKEN.trainPulseR / (TOKEN.trainInnerR + TOKEN.trainStroke / 2);

const zoneColor = (station: Station) =>
  ZONE_TRACK_COLORS[stationZoneMap[station]] ?? BRAND_LINE_COLOR;

/** The leg's zone colors as a hard-stop gradient across its width: each stop
 *  owns the track halfway to its neighbors, as on the line map. */
function zoneGradient(stops: Station[]): string {
  const last = stops.length - 1;
  if (last < 1) return stops.length ? zoneColor(stops[0]) : BRAND_LINE_COLOR;
  const bands = stops.map((station, i) => {
    const start = i === 0 ? 0 : ((i - 0.5) / last) * 100;
    const end = i === last ? 100 : ((i + 0.5) / last) * 100;
    return `${zoneColor(station)} ${start}% ${end}%`;
  });
  return `linear-gradient(to right, ${bands.join(", ")})`;
}

/** The map marker's 'my trip' blue, or its delayed gold / canceled gray; muted
 *  once the trip is over. Same precedence as the My Trip accent. */
function trainAccent(
  progress: TripProgressResult,
  model: TripDetailModel,
): string {
  if (progress.isEnded || model.isCanceledOrSkipped) {
    return TRAIN_COLORS.canceled;
  }
  return model.isDelayed ? TRAIN_COLORS.delayed : TOKEN.myTrip;
}

/** The map's direction pointer (TOKEN.trainArrow), turned to point along the
 *  track and scaled to the card marker. */
const POINTER_SCALE = MARKER_PX / 2 / (TOKEN.trainInnerR + TOKEN.trainStroke / 2);

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
  const accent = trainAccent(progress, model);
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
            const color = zoneColor(station);
            const size = isEndpoint ? ENDPOINT_DOT_PX : STOP_DOT_PX;
            return (
              <span
                key={station}
                className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-card"
                style={{
                  left: `${pct}%`,
                  width: size,
                  height: size,
                  border: `${isEndpoint ? 3 : 2.5}px solid ${color}`,
                }}
                title={station}
                aria-hidden="true"
              >
                {isEndpoint && (
                  <span
                    className="rounded-full"
                    style={{
                      width: size * TOKEN.terminalCoreRatio,
                      height: size * TOKEN.terminalCoreRatio,
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
              style={{ left: `${markerPct}%`, width: MARKER_PX, height: MARKER_PX }}
              aria-hidden="true"
            >
              {/* The map marker's soft halo. */}
              <span
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{
                  width: MARKER_PX * HALO_SCALE,
                  height: MARKER_PX * HALO_SCALE,
                  backgroundColor: accent,
                  opacity: TOKEN.trainPulseOpacity,
                }}
              />
              {/* A brief pulse on each fresh GPS fix (re-keyed per report),
                  rather than an endless animation on a screen left open for
                  the whole ride. */}
              {showLive && (
                <span
                  key={vehicle.timestamp}
                  className="absolute inset-0 rounded-full opacity-40 animate-ping motion-reduce:animate-none"
                  style={{ backgroundColor: accent, animationIterationCount: 2 }}
                />
              )}
              {/* Direction pointer, tucked under the disc as on the map; the
                  rider's leg always runs left to right here. */}
              <svg
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-visible"
                width={MARKER_PX}
                height={MARKER_PX}
                viewBox={`${-MARKER_PX / 2} ${-MARKER_PX / 2} ${MARKER_PX} ${MARKER_PX}`}
              >
                <path
                  d={TOKEN.trainArrow}
                  fill={accent}
                  transform={`rotate(90) scale(${POINTER_SCALE})`}
                />
              </svg>
              <span
                className={cn(
                  "absolute inset-0 flex items-center justify-center rounded-full bg-card text-[13px] font-black tabular-nums",
                  isEstimate && "opacity-75",
                )}
                style={{ border: `3px solid ${accent}`, color: accent }}
              >
                {trip.trip}
              </span>
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
