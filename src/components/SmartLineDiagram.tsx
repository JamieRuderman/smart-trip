/**
 * SmartLineDiagram — Mini-Metro style SVG schematic.
 *
 * The SVG itself draws with literal hex colors (so trains stay legible on
 * any background); Tailwind tokens are reserved for text and chrome so
 * light/dark mode still works.
 */

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MapTrain } from "@/hooks/useMapTrains";
import type { Station } from "@/types/smartSchedule";
import stations from "@/data/stations";
import { stationZoneMap } from "@/lib/stationUtils";
import {
  DIAGRAM_STATIONS,
  FERRY_WAYPOINTS,
  ROUTE_PATH_D,
  BRAND_LINE_COLOR,
  ZONE_TRACK_COLORS,
} from "@/data/smartLineLayout";
import { snapToPath, positionOnPath } from "@/lib/pathSnap";
import { trainStationProgress } from "@/lib/trainProgress";
import { scheduledProgress } from "@/lib/trainMotion";
import { getNextFerryDeparture } from "@/lib/scheduleUtils";
import { minutesOfDay, parseTimeToMinutes } from "@/lib/timeUtils";
import { DELAY_MINUTES_THRESHOLD } from "@/lib/realtimeConstants";

const TOKEN = {
  lineW: 18,
  stationStroke: 6,
  stationR: 11,
  terminalR: 16,
  labelSize: 18,
  terminalSize: 22,
  labelWeight: 500,
  // Theme-backed colors — SVG `fill`/`stroke` accept `hsl(var(...))` in all
  // modern browsers, so the diagram inverts correctly in dark mode.
  stationFill: "hsl(var(--background))",
  /** Dashed ferry extension + terminus stroke. Reads as a secondary detail
   *  on both light and dark backgrounds via the muted-foreground token. */
  detailStroke: "hsl(var(--muted-foreground))",
  /** Base track color when zone-coloring is on (inactive-looking rail). */
  mutedTrack: "hsl(var(--border))",
} as const;

const ONTIME_COLOR = "hsl(var(--foreground))";
const DELAYED_COLOR = "hsl(var(--smart-gold))";
const CANCELED_COLOR = "hsl(var(--muted-foreground))";

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

const USER_LOCATION_COLOR = "#1e88ff";

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
  const selected: Station[] = [];
  if (fromStation) selected.push(fromStation);
  if (toStation) selected.push(toStation);
  const enlargedStations = selected.length > 0 ? new Set<Station>(selected) : null;
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

  // Render window — cropped to the drawn content so the diagram fills the
  // container height. Horizontal clipping at phone widths is acceptable.
  const vbX = 10;
  const vbY = 40;
  const vbW = 780;
  const vbH = 1390;

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
        viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          width: "100%",
          height: "100%",
          display: "block",
        }}
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

        {colorTrackByZone && <ZoneLabels />}

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

// ── Station marker ────────────────────────────────────────────────────────

interface StationMarkerProps {
  station: Station;
  x: number;
  y: number;
  isTerminal: boolean;
  colorTrackByZone: boolean;
  onClick?: (station: Station) => void;
}

function StationMarker({
  station,
  x,
  y,
  isTerminal,
  colorTrackByZone,
  onClick,
}: StationMarkerProps) {
  const r = isTerminal ? TOKEN.terminalR : TOKEN.stationR;
  // All labels pin left of their dot; the right margin is reserved for zone
  // headings when `colorTrackByZone` is on.
  const labelX = x - (r + 28);
  const stroke = colorTrackByZone
    ? ZONE_TRACK_COLORS[stationZoneMap[station]] ?? BRAND_LINE_COLOR
    : BRAND_LINE_COLOR;

  return (
    <g
      style={{ cursor: onClick ? "pointer" : "default" }}
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation();
              onClick(station);
            }
          : undefined
      }
    >
      <circle cx={x} cy={y} r={32} fill="transparent" />
      <circle
        cx={x}
        cy={y}
        r={r}
        fill={TOKEN.stationFill}
        stroke={stroke}
        strokeWidth={TOKEN.stationStroke}
      />
      {isTerminal && (
        <circle cx={x} cy={y} r={r * 0.42} fill={stroke} />
      )}
      <StationLabel
        station={station}
        x={labelX}
        y={y}
        isTerminal={isTerminal}
      />
    </g>
  );
}

// ── User location marker ─────────────────────────────────────────────────
//
// Pulsing blue dot overlaying the station closest to the user. Matches the
// train-marker pulse cadence so the two animations read as related.

function UserLocationMarker({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`} pointerEvents="none">
      <circle r={30} fill={USER_LOCATION_COLOR} opacity={0.3}>
        <animate attributeName="r" values="22;36;22" dur="2s" repeatCount="indefinite" />
        <animate
          attributeName="opacity"
          values="0.4;0.08;0.4"
          dur="2s"
          repeatCount="indefinite"
        />
      </circle>
      <circle
        r={11}
        fill={USER_LOCATION_COLOR}
        stroke={TOKEN.stationFill}
        strokeWidth={4}
      />
    </g>
  );
}

// Labels that are too long to sit comfortably on one line are split into
// two stacked tspans. Add any future multi-line overrides here.
const MULTILINE_LABELS: Partial<Record<Station, [string, string]>> = {
  "Sonoma County Airport": ["Sonoma County", "Airport"],
};

function StationLabel({
  station,
  x,
  y,
  isTerminal,
}: {
  station: Station;
  x: number;
  y: number;
  isTerminal: boolean;
}) {
  const fontSize = isTerminal ? TOKEN.terminalSize : TOKEN.labelSize;
  const fontWeight = isTerminal ? 700 : TOKEN.labelWeight;
  const wrapped = MULTILINE_LABELS[station];
  return (
    <text
      x={x}
      y={y + 5}
      textAnchor="end"
      fontSize={fontSize}
      fontWeight={fontWeight}
      className="fill-foreground"
      style={{ fontFamily: "Inter, sans-serif" }}
    >
      {wrapped ? (
        <>
          <tspan x={x} dy={-fontSize * 0.55}>
            {wrapped[0]}
          </tspan>
          <tspan x={x} dy={fontSize * 1.1}>
            {wrapped[1]}
          </tspan>
        </>
      ) : (
        station
      )}
    </text>
  );
}

// ── Train marker ──────────────────────────────────────────────────────────

interface TrainMarkerProps {
  train: MapTrain;
  pathEl: SVGPathElement;
  stationArcs: number[];
  selected: boolean;
  now: Date;
  onClick?: (train: MapTrain) => void;
}

/** Re-render cadence for schedule-driven train motion. 1s keeps station-to-
 *  station segments (several minutes) visually smooth. */
const MOTION_TICK_MS = 1000;

function useClockTick(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function TrainMarker({
  train,
  pathEl,
  stationArcs,
  selected,
  onClick,
  now,
}: TrainMarkerProps) {
  const scheduled = scheduledProgress(train, now);
  const fallback = trainStationProgress(train);
  const progress = scheduled?.progress ?? fallback.progress;
  const direction = scheduled?.direction ?? fallback.direction;
  const pos = positionOnPath(progress, pathEl, stationArcs, direction);

  const isDelayed =
    !train.isCanceled &&
    train.delayMinutes !== null &&
    train.delayMinutes >= DELAY_MINUTES_THRESHOLD;

  const accent = train.isCanceled
    ? CANCELED_COLOR
    : isDelayed
      ? DELAYED_COLOR
      : ONTIME_COLOR;

  const arrowRot = pos.bearing;
  const label = train.tripNumber != null ? String(train.tripNumber) : "•";

  return (
    <g
      transform={`translate(${pos.x}, ${pos.y})`}
      style={{ cursor: onClick ? "pointer" : "default" }}
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation();
              onClick(train);
            }
          : undefined
      }
    >
      <circle r={30} fill={accent} opacity={0.18}>
        <animate attributeName="r" values="24;34;24" dur="2s" repeatCount="indefinite" />
        <animate
          attributeName="opacity"
          values="0.28;0.05;0.28"
          dur="2s"
          repeatCount="indefinite"
        />
      </circle>
      <g transform={`rotate(${arrowRot})`}>
        <path d="M 0 -33 L 8.5 -18 L -8.5 -18 Z" fill={accent} />
      </g>
      <circle r={18} fill={TOKEN.stationFill} stroke={accent} strokeWidth={6} />
      <text
        y={5.5}
        textAnchor="middle"
        fill={accent}
        style={{
          fontFamily: "Inter, sans-serif",
          fontWeight: 900,
          fontSize: "15px",
          letterSpacing: "0.01em",
        }}
      >
        {label}
      </text>
      {selected && (
        <circle r={40} fill="none" stroke={accent} strokeWidth={2.5} strokeDasharray="4 4" />
      )}
    </g>
  );
}

// Right-margin zone headings, colored per zone. Positioned at each zone's
// vertical midpoint; x values track the line's curve so each label reads as
// attached to its segment without crowding the station dots.
const ZONE_LABEL_POSITIONS: { zone: number; x: number; y: number }[] = [
  { zone: 1, x: 260, y: 120 },
  { zone: 2, x: 345, y: 280 },
  { zone: 3, x: 395, y: 560 },
  { zone: 4, x: 515, y: 950 },
  { zone: 5, x: 545, y: 1200 },
];

function ZoneLabels() {
  const { t } = useTranslation();
  return (
    <g>
      {ZONE_LABEL_POSITIONS.map(({ zone, x, y }) => (
        <text
          key={zone}
          x={x}
          y={y}
          fontSize={24}
          fontWeight={700}
          fill={ZONE_TRACK_COLORS[zone]}
          style={{ fontFamily: "Inter, sans-serif" }}
        >
          {t("mapDiagram.zoneLabel", { zone })}
        </text>
      ))}
    </g>
  );
}

const ZoneSegments = memo(function ZoneSegments({
  pathD,
  totalLength,
  stationArcs,
}: {
  pathD: string;
  totalLength: number;
  stationArcs: number[];
}) {
  const L = totalLength;
  // arc-from-north → path-param (path drawn S→N; path s = L − arc-from-N).
  const ps = stationArcs.map((a) => L - a);

  const segs: React.ReactElement[] = [];
  for (let i = 0; i < stations.length; i++) {
    const here = ps[i];
    const nMid = i === 0 ? L : (ps[i - 1] + here) / 2;
    const sMid = i === stations.length - 1 ? 0 : (here + ps[i + 1]) / 2;
    const len = nMid - sMid;
    if (len <= 0) continue;
    const color =
      ZONE_TRACK_COLORS[stationZoneMap[stations[i]]] ?? BRAND_LINE_COLOR;
    segs.push(
      <path
        key={stations[i]}
        d={pathD}
        stroke={color}
        strokeWidth={TOKEN.lineW}
        strokeLinecap="butt"
        strokeLinejoin="round"
        fill="none"
        strokeDasharray={`0 ${sMid} ${len} ${L}`}
      />,
    );
  }
  return <g>{segs}</g>;
});

// ── Ferry terminus glyph ──────────────────────────────────────────────────

function FerryTerminus({
  x,
  y,
  now,
}: {
  x: number;
  y: number;
  now: Date;
}) {
  const { t } = useTranslation();
  const ferry = getNextFerryDeparture(now);
  const nowMinutes = minutesOfDay(now);
  const minsUntil = ferry
    ? Math.max(0, parseTimeToMinutes(ferry.depart) - nowMinutes)
    : null;
  // Falls back to a "no more ferries today" badge once the last boat is out
  // so the label never goes blank.
  const etaLabel =
    minsUntil != null
      ? t("mapDiagram.nextFerryBadge", { minutes: minsUntil })
      : t("mapDiagram.noMoreFerries");

  return (
    <g transform={`translate(${x}, ${y})`}>
      <circle
        r={TOKEN.terminalR + 2}
        fill={TOKEN.stationFill}
        stroke={TOKEN.detailStroke}
        strokeWidth={TOKEN.stationStroke}
      />
      <path d="M -7 0 Q -3.5 -4 0 0 T 7 0" stroke={TOKEN.detailStroke} strokeWidth={2} fill="none" strokeLinecap="round" />
      <path d="M -7 4 Q -3.5 0 0 4 T 7 4" stroke={TOKEN.detailStroke} strokeWidth={2} fill="none" strokeLinecap="round" />
      <text
        y={TOKEN.terminalR + 30}
        textAnchor="middle"
        fontSize={TOKEN.terminalSize}
        fontWeight={800}
        className="fill-foreground"
        style={{ fontFamily: "Inter, sans-serif" }}
      >
        {t("mapDiagram.sanFrancisco")}
      </text>
      <text
        y={TOKEN.terminalR + 50}
        textAnchor="middle"
        fontSize={12}
        fontWeight={600}
        className="fill-muted-foreground"
        letterSpacing="0.2em"
        style={{ fontFamily: "Inter, sans-serif" }}
      >
        {etaLabel}
      </text>
    </g>
  );
}

/** Quarter-circle rounded-corner path through a short waypoint list. */
function buildSmoothPath(
  pts: { x: number; y: number }[],
  radius: number,
): string {
  if (pts.length === 0) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1], cur = pts[i], next = pts[i + 1];
    const dx1 = cur.x - prev.x, dy1 = cur.y - prev.y;
    const len1 = Math.hypot(dx1, dy1);
    const dx2 = next.x - cur.x, dy2 = next.y - cur.y;
    const len2 = Math.hypot(dx2, dy2);
    const r = Math.min(radius, len1 / 2, len2 / 2);
    const n1x = dx1 / len1, n1y = dy1 / len1;
    const n2x = dx2 / len2, n2y = dy2 / len2;
    const p1 = { x: cur.x - n1x * r, y: cur.y - n1y * r };
    const p2 = { x: cur.x + n2x * r, y: cur.y + n2y * r };
    d += ` L ${p1.x} ${p1.y} Q ${cur.x} ${cur.y} ${p2.x} ${p2.y}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}
