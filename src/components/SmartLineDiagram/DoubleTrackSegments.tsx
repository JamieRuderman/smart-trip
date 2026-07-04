import { memo } from "react";
import { DOUBLE_TRACK_SEGMENTS } from "@/data/smartLineLayout";
import { arcFromNorthAtProgress } from "@/lib/pathSnap";
import { TOKEN } from "./tokens";

interface DoubleTrackSegmentsProps {
  pathD: string;
  totalLength: number;
  stationArcs: number[];
}

/**
 * Cuts a narrow background-colored channel through the normal route stroke.
 * The two remaining halves read as parallel rails while retaining all zone
 * colors and selected-range muting painted underneath.
 */
export const DoubleTrackSegments = memo(function DoubleTrackSegments({
  pathD,
  totalLength,
  stationArcs,
}: DoubleTrackSegmentsProps) {
  return (
    <g aria-hidden="true">
      {DOUBLE_TRACK_SEGMENTS.map((segment, index) => {
        const northS =
          totalLength -
          arcFromNorthAtProgress(segment.northProgress, stationArcs);
        const southS =
          totalLength -
          arcFromNorthAtProgress(segment.southProgress, stationArcs);
        const length = northS - southS;

        return (
          <path
            key={index}
            d={pathD}
            stroke={TOKEN.stationFill}
            strokeWidth={TOKEN.doubleTrackGapW}
            strokeLinecap="butt"
            strokeLinejoin="round"
            fill="none"
            strokeDasharray={`0 ${southS} ${length} ${totalLength}`}
          />
        );
      })}
    </g>
  );
});
