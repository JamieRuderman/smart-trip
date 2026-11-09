/**
 * SmartLineDiagram — Mini-Metro style SVG schematic.
 *
 * Layout has two sibling SVG groups:
 *
 *   1. Zoomable group — wraps the path, zone segments, station dots, train
 *      markers, my-trip dot, and ferry glyph. Pan/zoom transform on
 *      this `<g>` makes everything inside scale together.
 *   2. Label layer — station labels, zone labels, and ferry text. Lives
 *      outside the zoomable group so its font sizes can stay at constant
 *      CSS pixel targets regardless of zoom; each label hand-applies the
 *      pan/zoom transform to its anchor coords.
 *
 * Colors come from `hsl(var(--token))` so the diagram inverts cleanly in
 * dark mode. All sizes/animations live in `./tokens`.
 */

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Maximize2 } from "lucide-react";
import type { MapTrain } from "@/hooks/useMapTrains";
import type { Station } from "@/types/smartSchedule";
import { SAN_FRANCISCO, placeStation, type Place } from "@/lib/places";
import { useSvgScreenScale } from "@/hooks/useSvgScreenScale";
import { usePanZoom } from "@/hooks/usePanZoom";
import {
  DIAGRAM_STATIONS,
  FERRY_WAYPOINTS,
  ROUTE_PATH_D,
  BRAND_LINE_COLOR,
} from "@/data/smartLineLayout";
import { snapToPath } from "@/lib/pathSnap";
import { stationIndexMap, stationTrackColor } from "@/lib/stationUtils";
import { FERRY_CONSTANTS } from "@/lib/fareConstants";
import { TOKEN, MOTION_TICK_MS } from "./tokens";
import { useClockTick } from "./useClockTick";
import { buildSmoothPath } from "./buildSmoothPath";
import { StationDot } from "./StationDot";
import { StationLabel } from "./StationLabel";
import { UserLocationMarker } from "./UserLocationMarker";
import { TrainMarker } from "./TrainMarker";
import { ZoneLabels } from "./ZoneLabels";
import { ZoneSegments } from "./ZoneSegments";
import { DoubleTrackSegments } from "./DoubleTrackSegments";
import { FerryTerminus } from "./FerryTerminus";
import { FerryLabels } from "./FerryLabels";

// ── Props ─────────────────────────────────────────────────────────────────

export interface SmartLineDiagramProps {
  /** All live trains — typically `useMapTrains().trains`. */
  trains: MapTrain[];
  /** Currently-selected train key (matches `MapTrain.key`). */
  selectedTrainKey?: string | null;
  onTrainClick?: (train: MapTrain) => void;
  /** Tap a station or the San Francisco ferry terminus — optional hook for
   *  detail cards / filtering. */
  onStationClick?: (place: Place) => void;
  /** Color the track segments by zone instead of a single brand green. */
  colorTrackByZone?: boolean;
  /** Show the dashed ferry extension from Larkspur to the SF Ferry Building. */
  showFerry?: boolean;
  /** User's selected origin — enlarged in place of the north terminus. San
   *  Francisco highlights the ferry terminus and its Larkspur connection. */
  fromStation?: Place | null;
  /** User's selected destination — enlarged in place of the south terminus. */
  toStation?: Place | null;
  /** Station closest to the user's current location — shows a pulsing blue dot. */
  userStation?: Station | null;
  /** Key (matches `MapTrain.key`) of the user's focused ("Go") trip's live
   *  marker, if any. Painted with the blue "my trip" treatment. */
  myTrainKey?: string | null;
  /** Optional wrapper class (e.g. for max-width or padding). */
  className?: string;
}

// Render window — extends past both edges of the track so wide station
// labels ("Marin Civic Center", "Novato Downtown") fit on the right and
// zone headings ("Zone 1") fit on the left at phone widths. The track
// itself runs roughly x=180–560 in viewBox space.
// Vertically CENTER the content (Windsor at y≈49 down through the ferry
// labels) with balanced padding top and bottom, rather than padding only the
// bottom (which left the diagram bottom-heavy). The bottom must clear the
// ferry "San Francisco" / next-ferry labels — they're constant CSS-px, so at
// small fit scales they occupy more viewBox units and reach ~y1464, hence the
// bottom sits at 1470 (≈30 units below) while the top sits ~30 units above
// the content, keeping the two margins close across viewports.
const VIEW_BOX = { x: -50, y: 20, width: 900, height: 1450 } as const;

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
  myTrainKey = null,
  className,
}: SmartLineDiagramProps) {
  const { t } = useTranslation();

  // When the user has picked either endpoint, enlarge whichever are set in
  // place of the corridor terminals. Falls back to first/last only when
  // neither is selected, so the diagram always has emphasized anchor points.
  const enlargedStations = useMemo(() => {
    const selected = new Set<Place>();
    if (fromStation) selected.add(fromStation);
    if (toStation) selected.add(toStation);
    return selected.size > 0 ? selected : null;
  }, [fromStation, toStation]);

  const fromTrainStation = fromStation ? placeStation(fromStation) : null;
  const toTrainStation = toStation ? placeStation(toStation) : null;
  const ferrySelected = fromStation === SAN_FRANCISCO || toStation === SAN_FRANCISCO;

  // Index range of the user's selected from→to span. When both endpoints are
  // set, stations outside this range render in the muted track color.
  const selectedRange = useMemo(() => {
    if (!fromTrainStation || !toTrainStation) return null;
    const a = stationIndexMap[fromTrainStation];
    const b = stationIndexMap[toTrainStation];
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }, [fromTrainStation, toTrainStation]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const pathRef = useRef<SVGPathElement | null>(null);
  const [snap, setSnap] = useState<{
    stations: { station: Station; x: number; y: number }[];
    arcs: number[];
    totalLength: number;
  } | null>(null);

  // Path is drawn S → N, so we store arc-length-from-the-NORTH end for each
  // station — that's what `positionOnPath` expects to interpolate into.
  //
  // useLayoutEffect (not useEffect): the zone-coloured track, station dots and
  // train markers are all gated on `snap`, so with a post-paint effect the
  // first painted frame shows a bare path with none of them, and they pop in
  // on the next frame — a visible "blink" every time the diagram mounts.
  // Measuring before paint renders the positioned diagram in one frame.
  // Safe under SSR: this component only renders on the (non-prerendered)
  // /map-diagram route, so the effect never runs server-side.
  useLayoutEffect(() => {
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
  const ferryMuted = !!selectedRange && !ferrySelected;
  const ferryStroke = ferryMuted
    ? TOKEN.mutedTrack
    : !ferrySelected
      ? TOKEN.detailStroke
      : colorTrackByZone
        ? stationTrackColor(FERRY_CONSTANTS.FERRY_STATION)
        : BRAND_LINE_COLOR;
  const onFerryClick = onStationClick && (() => onStationClick(SAN_FRANCISCO));
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
            markers, my-trip dot, ferry glyph. */}
        <g transform={transform}>
          {showFerry && (
            <g opacity={0.9}>
              <path
                d={ferryD}
                stroke={ferryStroke}
                strokeWidth={TOKEN.lineW * 0.55}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={`${TOKEN.lineW * 0.9} ${TOKEN.lineW * 1.0}`}
                fill="none"
              />
              <FerryTerminus
                x={FERRY_WAYPOINTS[2].x}
                y={FERRY_WAYPOINTS[2].y}
                stroke={ferryStroke}
                selected={ferrySelected}
                onClick={onFerryClick}
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
              fromStation={fromTrainStation}
              toStation={toTrainStation}
            />
          )}

          {snap && (
            <DoubleTrackSegments
              pathD={ROUTE_PATH_D}
              totalLength={snap.totalLength}
              stationArcs={snap.arcs}
            />
          )}

          {stationList.map((st, i, arr) => {
            const isEnlarged = enlargedStations
              ? enlargedStations.has(st.station)
              : i === 0 || i === arr.length - 1;
            const idx = stationIndexMap[st.station];
            const isMuted =
              !!selectedRange &&
              (idx < selectedRange.min || idx > selectedRange.max);
            return (
              <StationDot
                key={st.station}
                station={st.station}
                x={st.x}
                y={st.y}
                isTerminal={isEnlarged}
                colorTrackByZone={colorTrackByZone}
                muted={isMuted}
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
            // The user's train renders last so it paints on top of any
            // other marker that overlaps it on the schematic.
            [
              ...trains.filter((t) => t.key !== myTrainKey),
              ...trains.filter((t) => t.key === myTrainKey),
            ].map((train) => (
              <TrainMarker
                key={train.key}
                train={train}
                pathEl={pathRef.current!}
                stationArcs={snap.arcs}
                pathLength={snap.totalLength}
                selected={train.key === selectedTrainKey}
                isMyTrain={train.key === myTrainKey}
                onClick={onTrainClick}
                now={now}
              />
            ))}
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
              labelSide={st.station === "Larkspur" ? "left" : "right"}
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
            isTerminal={enlargedStations?.has(SAN_FRANCISCO) ?? false}
            muted={ferryMuted}
            inbound={fromStation === SAN_FRANCISCO}
            onClick={onFerryClick}
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
