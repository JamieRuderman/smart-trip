import type { MapTrain } from "@/hooks/useMapTrains";
import { positionOnPath } from "@/lib/pathSnap";
import { trainStationProgress } from "@/lib/trainProgress";
import { gpsStationProgress } from "@/lib/trainGpsProgress";
import { scheduledProgress } from "@/lib/trainMotion";
import { DELAY_MINUTES_THRESHOLD } from "@/lib/realtimeConstants";
import { ANIM, FONT_FAMILY, TOKEN, TRAIN_COLORS } from "./tokens";

interface TrainMarkerProps {
  train: MapTrain;
  pathEl: SVGPathElement;
  stationArcs: number[];
  selected: boolean;
  /** True when this is the train the user is currently riding. */
  userRiding?: boolean;
  /** When set, project these coords onto the rail instead of the train's
   *  own GTFS-RT position. Used for the rider's latched train so the
   *  marker tracks the phone (which leads the feed by ~15-30 s). */
  overrideLat?: number | null;
  overrideLng?: number | null;
  now: Date;
  onClick?: (train: MapTrain) => void;
}

export function TrainMarker({
  train,
  pathEl,
  stationArcs,
  selected,
  userRiding = false,
  overrideLat = null,
  overrideLng = null,
  onClick,
  now,
}: TrainMarkerProps) {
  // GPS is ground truth. Schedule is only consulted when the feed
  // doesn't give us a usable lat/lng — otherwise the schedule's
  // multi-station error would tug the marker off where the train
  // actually is.
  const gpsTrain =
    overrideLat != null && overrideLng != null
      ? { ...train, latitude: overrideLat, longitude: overrideLng }
      : train;
  const gps = gpsStationProgress(gpsTrain);
  const resolved =
    gps ?? scheduledProgress(train, now) ?? trainStationProgress(train);

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

  // Riding swaps the on-time accent for blue; delayed/canceled win so the
  // status signal isn't lost.
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
