import type { MapTrain } from "@/hooks/useMapTrains";
import { positionOnPath } from "@/lib/pathSnap";
import { trainStationProgress } from "@/lib/trainProgress";
import { scheduledProgress } from "@/lib/trainMotion";
import { DELAY_MINUTES_THRESHOLD } from "@/lib/realtimeConstants";
import { ANIM, FONT_FAMILY, TOKEN, TRAIN_COLORS } from "./tokens";

interface TrainMarkerProps {
  train: MapTrain;
  pathEl: SVGPathElement;
  stationArcs: number[];
  selected: boolean;
  now: Date;
  onClick?: (train: MapTrain) => void;
}

export function TrainMarker({
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
    ? TRAIN_COLORS.canceled
    : isDelayed
      ? TRAIN_COLORS.delayed
      : TRAIN_COLORS.onTime;

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
      <circle r={TOKEN.trainPulseR} fill={accent} opacity={TOKEN.trainPulseOpacity}>
        <animate
          attributeName="r"
          values={ANIM.trainPulseR}
          dur={ANIM.pulseDur}
          repeatCount="indefinite"
        />
        <animate
          attributeName="opacity"
          values={ANIM.trainPulseOpacity}
          dur={ANIM.pulseDur}
          repeatCount="indefinite"
        />
      </circle>
      <g transform={`rotate(${pos.bearing})`}>
        <path d={TOKEN.trainArrow} fill={accent} />
      </g>
      <circle
        r={TOKEN.trainInnerR}
        fill={TOKEN.stationFill}
        stroke={accent}
        strokeWidth={TOKEN.trainStroke}
      />
      <text
        y={TOKEN.trainTextBaseline}
        textAnchor="middle"
        fill={accent}
        style={{
          fontFamily: FONT_FAMILY,
          fontWeight: TOKEN.trainNumberWeight,
          fontSize: `${TOKEN.trainNumberSize}px`,
          letterSpacing: TOKEN.labelTracking,
        }}
      >
        {label}
      </text>
      {selected && (
        <circle
          r={TOKEN.trainSelectedR}
          fill="none"
          stroke={accent}
          strokeWidth={TOKEN.trainSelectedStroke}
          strokeDasharray={TOKEN.trainSelectedDash}
        />
      )}
    </g>
  );
}
