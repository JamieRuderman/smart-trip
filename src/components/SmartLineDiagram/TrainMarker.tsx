import type { MapTrain } from "@/hooks/useMapTrains";
import { positionOnPath } from "@/lib/pathSnap";
import { trainStationProgress } from "@/lib/trainProgress";
import { gpsStationProgress } from "@/lib/trainGpsProgress";
import { scheduledProgress } from "@/lib/trainMotion";
import { DELAY_MINUTES_THRESHOLD } from "@/lib/realtimeConstants";
import { ANIM, FONT_FAMILY, TOKEN, TRAIN_COLORS } from "./tokens";

/** When schedule and GPS disagree by more than this many station-segments,
 *  pull the schedule progress halfway toward GPS so big real deviations
 *  surface without per-tick jitter from raw GPS. */
const SCHEDULE_GPS_DRIFT_THRESHOLD = 1.0;
const SCHEDULE_GPS_BLEND = 0.5;

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
  // Resolve progress in this order:
  //  1. Schedule-driven interpolation — smooth motion, absorbs delayMinutes.
  //  2. GPS projection (corrects schedule when reality has drifted; also the
  //     primary source when the schedule can't match the trip).
  //  3. Station-midpoint fallback — last resort.
  const scheduled = scheduledProgress(train, now);
  const gps = gpsStationProgress(train);
  const fallback = trainStationProgress(train);

  let resolved = scheduled ?? gps ?? fallback;

  if (scheduled && gps) {
    const drift = gps.progress - scheduled.progress;
    if (Math.abs(drift) > SCHEDULE_GPS_DRIFT_THRESHOLD) {
      resolved = {
        ...scheduled,
        progress: scheduled.progress + drift * SCHEDULE_GPS_BLEND,
      };
    }
  }

  const pos = positionOnPath(
    resolved.progress,
    pathEl,
    stationArcs,
    resolved.direction,
  );

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
