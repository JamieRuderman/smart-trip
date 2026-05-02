/**
 * SmartLineDiagram — Mini-Metro style SVG schematic.
 *
 * Layout has two sibling SVG groups:
 *
 *   1. Zoomable group — wraps the path, zone segments, station dots, train
 *      markers, user-location dot, and ferry glyph. Pan/zoom transform on
 *      this `<g>` makes everything inside scale together.
 *   2. Label layer — station labels, zone labels, and ferry text. Lives
 *      outside the zoomable group so its font sizes can stay at constant
 *      CSS pixel targets regardless of zoom; each label hand-applies the
 *      pan/zoom transform to its anchor coords.
 *
 * Colors come from `hsl(var(--token))` so the diagram inverts cleanly in
 * dark mode. All sizes/animations live in `./tokens`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Maximize2 } from "lucide-react";
import type { MapTrain } from "@/hooks/useMapTrains";
import type { Station } from "@/types/smartSchedule";
import { useSvgScreenScale } from "@/hooks/useSvgScreenScale";
import { usePanZoom } from "@/hooks/usePanZoom";
import {
  DIAGRAM_STATIONS,
  FERRY_WAYPOINTS,
  ROUTE_PATH_D,
  BRAND_LINE_COLOR,
} from "@/data/smartLineLayout";
import { snapToPath } from "@/lib/pathSnap";
import { TOKEN, MOTION_TICK_MS } from "./tokens";
import { useClockTick } from "./useClockTick";
import { buildSmoothPath } from "./buildSmoothPath";
import { StationDot } from "./StationDot";
import { StationLabel } from "./StationLabel";
import { UserLocationMarker } from "./UserLocationMarker";
import { TrainMarker } from "./TrainMarker";
import { ZoneLabels } from "./ZoneLabels";
import { ZoneSegments } from "./ZoneSegments";
import { FerryTerminus } from "./FerryTerminus";
import { FerryLabels } from "./FerryLabels";

// ── Props ─────────────────────────────────────────────────────────────────

export interface SmartLineDiagramProps {
  /** All live trains — typically `useMapTrains().trains`. */
  trains: MapTrain[];
  /** Currently-selected train key (matches `MapTrain.key`). */
  selectedTrainKey?: string | null;
  onTrainClick?: (train: MapTrain) => void;
  /** Tap a station — optional hook for detail cards / filtering. */
  onStationClick?: (station: Station) => void;
  /** Color the track segments by zone instead of a single brand green. */
  colorTrackByZone?: boolean;
  /** Show the dashed ferry extension from Larkspur to the SF Ferry Building. */
  showFerry?: boolean;
  /** User's selected origin station — enlarged in place of the north terminus. */
  fromStation?: Station | null;
  /** User's selected destination station — enlarged in place of the south terminus. */
  toStation?: Station | null;
  /** Station closest to the user's current location — shows a pulsing blue dot. */
  userStation?: Station | null;
  /** Key (matches `MapTrain.key`) of the train the user is currently riding,
   *  if any. Renders an inset blue dot on that train's marker. */
  userRidingTrainKey?: string | null;
  /** User's current GPS, used to override the latched train marker's
   *  position when riding — phone GPS is typically 15–30 s ahead of the
   *  train's GTFS-RT vehicle position, so the rider's marker should follow
   *  reality, not the lagging feed. */
  userLat?: number | null;
  userLng?: number | null;
  /** Optional wrapper class (e.g. for max-width or padding). */
  className?: string;
}

// Render window — extends well past the left edge of the track so wide
// station labels ("Santa Rosa Downtown", "Petaluma Downtown") have room
// at phone widths. The track itself starts around x=180 in viewBox space.
const VIEW_BOX = { x: -90, y: 40, width: 880, height: 1390 } as const;

// ── Component ─────────────────────────────────────────────────────────────

export function SmartLineDiagram({
  trains,
  selectedTrainKey = null,
  onTrainClick,
  onStationClick,
  colorTrackByZone = false,
  showFerry = true,
  fromStation = null,
  toStation = null,
  userStation = null,
  userRidingTrainKey = null,
  userLat = null,
  userLng = null,
  className,
}: SmartLineDiagramProps) {
  const { t } = useTranslation();

  // When the user has picked either endpoint, enlarge whichever are set in
  // place of the corridor terminals. Falls back to first/last only when
  // neither is selected, so the diagram always has emphasized anchor points.
  const enlargedStations = useMemo(() => {
    const selected = new Set<Station>();
    if (fromStation) selected.add(fromStation);
    if (toStation) selected.add(toStation);
    return selected.size > 0 ? selected : null;
  }, [fromStation, toStation]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const pathRef = useRef<SVGPathElement | null>(null);
  const [snap, setSnap] = useState<{
    stations: { station: Station; x: number; y: number }[];
    arcs: number[];
    totalLength: number;
  } | null>(null);

  // Path is drawn S → N, so we store arc-length-from-the-NORTH end for each
  // station — that's what `positionOnPath` expects to interpolate into.
  useEffect(() => {
    const el = pathRef.current;
    if (!el) return;
    const L = el.getTotalLength();
    const snapped = DIAGRAM_STATIONS.map(({ station, x, y }) => {
      const p = snapToPath(el, x, y);
      return { station, x: p.x, y: p.y, arc: L - p.s };
    });
    setSnap({
      stations: snapped.map(({ station, x, y }) => ({ station, x, y })),
      arcs: snapped.map((s) => s.arc),
      totalLength: L,
    });
  }, []);

  const ferryD = useMemo(() => buildSmoothPath(FERRY_WAYPOINTS, 28), []);
  const now = useClockTick(MOTION_TICK_MS);
  const screenScale = useSvgScreenScale(svgRef, VIEW_BOX.width, VIEW_BOX.height);
  const { tx, ty, scale, transform, reset } = usePanZoom(svgRef, {
    viewBox: VIEW_BOX,
    maxScale: 3,
  });
  const stationList = snap?.stations ?? DIAGRAM_STATIONS;

  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg
        ref={svgRef}
        viewBox={`${VIEW_BOX.x} ${VIEW_BOX.y} ${VIEW_BOX.width} ${VIEW_BOX.height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          touchAction: "none",
        }}
      >
        {/* Zoomable group — track, zone segments, station dots, train
            markers, user-location dot, ferry glyph. */}
        <g transform={transform}>
          {showFerry && (
            <g opacity={0.9}>
              <path
                d={ferryD}
                stroke={TOKEN.detailStroke}
                strokeWidth={TOKEN.lineW * 0.55}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={`${TOKEN.lineW * 0.9} ${TOKEN.lineW * 1.0}`}
                fill="none"
              />
              <FerryTerminus
                x={FERRY_WAYPOINTS[2].x}
                y={FERRY_WAYPOINTS[2].y}
              />
            </g>
          )}

          <path
            ref={pathRef}
            d={ROUTE_PATH_D}
            stroke={colorTrackByZone ? TOKEN.mutedTrack : BRAND_LINE_COLOR}
            strokeWidth={TOKEN.lineW}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />

          {colorTrackByZone && snap && (
            <ZoneSegments
              pathD={ROUTE_PATH_D}
              totalLength={snap.totalLength}
              stationArcs={snap.arcs}
            />
          )}

          {stationList.map((st, i, arr) => {
            const isEnlarged = enlargedStations
              ? enlargedStations.has(st.station)
              : i === 0 || i === arr.length - 1;
            return (
              <StationDot
                key={st.station}
                station={st.station}
                x={st.x}
                y={st.y}
                isTerminal={isEnlarged}
                colorTrackByZone={colorTrackByZone}
                onClick={onStationClick}
              />
            );
          })}

          {userStation &&
            stationList
              .filter((st) => st.station === userStation)
              .map((st) => (
                <UserLocationMarker
                  key={`user-${st.station}`}
                  x={st.x}
                  y={st.y}
                />
              ))}

          {pathRef.current &&
            snap &&
            trains.map((train) => {
              const isUserRiding = train.key === userRidingTrainKey;
              return (
                <TrainMarker
                  key={train.key}
                  train={train}
                  pathEl={pathRef.current!}
                  stationArcs={snap.arcs}
                  selected={train.key === selectedTrainKey}
                  userRiding={isUserRiding}
                  // Phone GPS leads the GTFS-RT feed by ~15-30 s. When the
                  // rider's train is latched, snap its marker to the phone
                  // so it doesn't trail behind the rider's actual position.
                  overrideLat={isUserRiding ? userLat : null}
                  overrideLng={isUserRiding ? userLng : null}
                  onClick={onTrainClick}
                  now={now}
                />
              );
            })}
        </g>

        {/* Label layer — constant CSS-pixel font sizes, hand-affined
            positions. Render above the zoomed group so labels paint on top. */}
        {colorTrackByZone && (
          <ZoneLabels
            screenScale={screenScale}
            tx={tx}
            ty={ty}
            scale={scale}
          />
        )}

        {stationList.map((st, i, arr) => {
          const isEnlarged = enlargedStations
            ? enlargedStations.has(st.station)
            : i === 0 || i === arr.length - 1;
          return (
            <StationLabel
              key={`label-${st.station}`}
              station={st.station}
              x={st.x}
              y={st.y}
              isTerminal={isEnlarged}
              screenScale={screenScale}
              tx={tx}
              ty={ty}
              scale={scale}
              onClick={onStationClick}
            />
          );
        })}

        {showFerry && (
          <FerryLabels
            x={FERRY_WAYPOINTS[2].x}
            y={FERRY_WAYPOINTS[2].y}
            now={now}
            screenScale={screenScale}
            tx={tx}
            ty={ty}
            scale={scale}
          />
        )}
      </svg>

      {(scale > 1.001 || tx !== 0 || ty !== 0) && (
        <button
          type="button"
          onClick={reset}
          aria-label={t("mapDiagram.resetZoom", "Reset zoom")}
          className="absolute top-3 right-3 z-10 flex items-center justify-center w-9 h-9 rounded-full bg-card border border-border text-foreground shadow-card hover:bg-accent"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
