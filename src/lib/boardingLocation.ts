import type { Station } from "@/types/smartSchedule";
import {
  getClosestStationWithDistance,
  getDistanceToStationKm,
} from "@/lib/stationUtils";

/**
 * Why a "Take this train" tap looks like it leaves from the wrong place:
 *  - `nearDestination`: the rider is closer to where the train is going than to
 *    where it leaves from — the classic "forgot to swap stations for the ride
 *    home" mistake.
 *  - `atOtherStation`: the rider is standing at a different SMART station.
 */
export type BoardingLocationWarning =
  | { kind: "nearDestination" }
  | { kind: "atOtherStation"; station: Station };

interface BoardingFix {
  lat: number;
  lng: number;
  /** Accuracy radius in meters; null when the platform omitted it. */
  accuracy: number | null;
}

/** How much nearer the destination must be than the origin before we call the
 *  trip reversed, so a rider partway between two close stations isn't nagged. */
const MIN_REVERSED_MARGIN_M = 500;

/** Within this radius of a station counts as standing at it. */
const AT_STATION_RADIUS_M = 400;

/** Only check trains leaving within this window — further out, where the rider
 *  is right now says little about where they'll board. */
const CHECK_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * Whether the rider's location is worth checking for a train departing the
 * boarding station at `departureAt`. Skipped once it has departed (the rider
 * may already be on board, somewhere down the line) and for trains too far out
 * for the current position to mean anything.
 */
export function shouldCheckBoardingLocation(
  departureAt: number,
  now: number,
): boolean {
  return departureAt > now && departureAt - now <= CHECK_WINDOW_MS;
}

/**
 * Compare a location fix against the leg the rider is about to focus, returning
 * a warning when they don't appear to be leaving from `from`: when they're
 * clearly nearer `to` than `from` (wherever they are — no station proximity is
 * required), or standing at another station. Otherwise silent, e.g. at home a
 * walk or drive from the origin.
 */
export function checkBoardingLocation(
  fix: BoardingFix,
  from: Station,
  to: Station,
): BoardingLocationWarning | null {
  const { lat, lng, accuracy } = fix;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  // An `accuracy`-sized error can swing the origin/destination difference by
  // up to twice that, so the margin has to clear 2× the radius to be trusted.
  const toOriginM = getDistanceToStationKm(lat, lng, from) * 1000;
  const toDestinationM = getDistanceToStationKm(lat, lng, to) * 1000;
  if (
    toOriginM - toDestinationM >=
    Math.max(MIN_REVERSED_MARGIN_M, 2 * (accuracy ?? 0))
  ) {
    return { kind: "nearDestination" };
  }

  // Stations sit ≥1.6 km apart, so a fix this close and this tight can't
  // belong to a neighbor instead.
  const closest = getClosestStationWithDistance(lat, lng);
  if (
    closest.station !== from &&
    closest.distanceKm * 1000 <= AT_STATION_RADIUS_M &&
    (accuracy == null || accuracy <= AT_STATION_RADIUS_M)
  ) {
    return { kind: "atOtherStation", station: closest.station };
  }

  return null;
}
