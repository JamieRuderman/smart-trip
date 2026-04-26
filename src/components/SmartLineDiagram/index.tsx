/**
 * SmartLineDiagram — Mini-Metro style SVG schematic.
 *
 * The SVG itself draws with literal HSL token colors (so trains stay legible
 * on any background); Tailwind tokens are reserved for text and chrome so
 * light/dark mode still works. All sizes/animations live in `./tokens`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { MapTrain } from "@/hooks/useMapTrains";
import type { Station } from "@/types/smartSchedule";
import { useSvgScreenScale } from "@/hooks/useSvgScreenScale";
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
import { StationMarker } from "./StationMarker";
import { UserLocationMarker } from "./UserLocationMarker";
import { TrainMarker } from "./TrainMarker";
import { ZoneLabels } from "./ZoneLabels";
import { ZoneSegments } from "./ZoneSegments";
import { FerryTerminus } from "./FerryTerminus";

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
  className,
}: SmartLineDiagramProps) {
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
  const screenScale = useSvgScreenScale(svgRef, VIEW_BOX.width);

  return (
    <div
      className={className}
      style={{
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
        style={{ width: "100%", height: "100%", display: "block" }}
      >
        {/* Ferry extension (below main line so it tucks under Larkspur) */}
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
              now={now}
              screenScale={screenScale}
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

        {colorTrackByZone && <ZoneLabels screenScale={screenScale} />}

        {(snap?.stations ?? DIAGRAM_STATIONS).map((st, i, arr) => {
          const isEnlarged = enlargedStations
            ? enlargedStations.has(st.station)
            : i === 0 || i === arr.length - 1;
          return (
            <StationMarker
              key={st.station}
              station={st.station}
              x={st.x}
              y={st.y}
              isTerminal={isEnlarged}
              colorTrackByZone={colorTrackByZone}
              screenScale={screenScale}
              onClick={onStationClick}
            />
          );
        })}

        {userStation &&
          (snap?.stations ?? DIAGRAM_STATIONS)
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
          trains.map((train) => (
            <TrainMarker
              key={train.key}
              train={train}
              pathEl={pathRef.current!}
              stationArcs={snap.arcs}
              selected={train.key === selectedTrainKey}
              onClick={onTrainClick}
              now={now}
            />
          ))}
      </svg>
    </div>
  );
}
