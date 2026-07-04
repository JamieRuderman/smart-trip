import { DOUBLE_TRACK_SEGMENTS } from "@/data/smartLineLayout";
import type { PathPosition } from "@/lib/pathSnap";
import { TOKEN } from "./tokens";

/**
 * Returns the lateral rail offset for a train in a passing section. The short
 * easing at each switch keeps animated markers from snapping sideways.
 */
export function doubleTrackOffset(progress: number): number {
  const segment = DOUBLE_TRACK_SEGMENTS.find(
    ({ northProgress, southProgress }) =>
      progress >= northProgress && progress <= southProgress,
  );
  if (!segment) return 0;

  const length = segment.southProgress - segment.northProgress;
  const distanceToSwitch = Math.min(
    progress - segment.northProgress,
    segment.southProgress - progress,
  );
  const rampLength = Math.min(0.04, length / 3);
  const t = Math.min(1, distanceToSwitch / rampLength);
  const eased = t * t * (3 - 2 * t);
  return TOKEN.doubleTrackRailOffset * eased;
}

/** Move a marker to the left side of its direction of travel. */
export function keepLeftOnDoubleTrack(
  position: PathPosition,
  progress: number,
): PathPosition {
  const offset = doubleTrackOffset(progress);
  if (offset === 0) return position;

  const radians = (position.bearing * Math.PI) / 180;
  return {
    ...position,
    x: position.x - Math.cos(radians) * offset,
    y: position.y - Math.sin(radians) * offset,
  };
}
