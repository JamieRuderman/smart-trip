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
  /** True when this is the train the user is currently riding. */
  userRiding?: boolean;
  now: Date;
  onClick?: (train: MapTrain) => void;
}

export function TrainMarker({
  train,
  pathEl,
  stationArcs,
  selected,
  userRiding = false,
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

  // When the user is riding this train, swap the default (black) on-time
  // accent for the user-location blue so the marker reads as "you are here"
  // at a glance. Delayed/canceled colors still take precedence — losing the
  // gold/gray status signal would hide important information.
  const accent = train.isCanceled
    ? TRAIN_COLORS.canceled
    : isDelayed
      ? TRAIN_COLORS.delayed
      : userRiding
        ? TOKEN.userLocation
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
      {userRiding && accent !== TOKEN.userLocation && (
        // Small blue badge in the lower-right of the marker — used when the
        // accent stays gold/gray (delayed/canceled) so the riding signal is
        // still visible. Skipped when the whole marker is already blue.
        <circle
          cx={TOKEN.trainInnerR * 0.7}
          cy={TOKEN.trainInnerR * 0.7}
          r={TOKEN.userOnTrainR}
          fill={TOKEN.userLocation}
          stroke={TOKEN.stationFill}
          strokeWidth={TOKEN.userOnTrainStroke}
        />
      )}
    </g>
  );
}
