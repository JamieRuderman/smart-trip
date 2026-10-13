import { memo } from "react";
import type { MapTrain } from "@/hooks/useMapTrains";
import { positionOnPath } from "@/lib/pathSnap";
import { trainStationProgress } from "@/lib/trainProgress";
import { gpsStationProgress } from "@/lib/trainGpsProgress";
import { scheduledProgress } from "@/lib/trainMotion";
import { isTrainDelayed } from "@/lib/realtimeConstants";
import { TOKEN, TRAIN_COLORS } from "./tokens";
import { keepLeftOnDoubleTrack } from "./doubleTrack";
import { TrainGlyph } from "./TrainGlyph";

interface TrainMarkerProps {
  train: MapTrain;
  pathEl: SVGPathElement;
  stationArcs: number[];
  /** Cached total path length, so the per-tick position math skips a forced
   *  `getTotalLength` layout read. */
  pathLength: number;
  selected: boolean;
  /** True when this is the user's focused ("Go") trip — painted with the blue
   *  "my trip" treatment. */
  isMyTrain?: boolean;
  now: Date;
  onClick?: (train: MapTrain) => void;
}

function TrainMarkerImpl({
  train,
  pathEl,
  stationArcs,
  pathLength,
  selected,
  isMyTrain = false,
  onClick,
  now,
}: TrainMarkerProps) {
  // GPS is ground truth. Schedule is only consulted when the feed
  // doesn't give us a usable lat/lng — otherwise the schedule's
  // multi-station error would tug the marker off where the train
  // actually is.
  const gps = gpsStationProgress(train);
  const resolved =
    gps ?? scheduledProgress(train, now) ?? trainStationProgress(train);

  const pos = keepLeftOnDoubleTrack(
    positionOnPath(
      resolved.progress,
      pathEl,
      stationArcs,
      resolved.direction,
      pathLength,
    ),
    resolved.progress,
  );

  const isDelayed = isTrainDelayed(train);

  // "My trip" swaps the on-time accent for blue; delayed/canceled win so the
  // status signal isn't lost.
  const accent = train.isCanceled
    ? TRAIN_COLORS.canceled
    : isDelayed
      ? TRAIN_COLORS.delayed
      : isMyTrain
        ? TOKEN.myTrip
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
      <TrainGlyph
        accent={accent}
        label={label}
        bearing={pos.bearing}
        selected={selected}
        myTripBadge={isMyTrain && accent !== TOKEN.myTrip}
      />
    </g>
  );
}

/**
 * Memoized: `now` is a stable reference between clock ticks, so a parent
 * re-render that isn't a tick (pan/zoom, selecting another train) skips every
 * marker whose own props are unchanged. On a tick `now` changes and all markers
 * re-render to advance — the intended motion update.
 */
export const TrainMarker = memo(TrainMarkerImpl);
