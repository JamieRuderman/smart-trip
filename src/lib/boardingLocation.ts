import type { Station } from "@/types/smartSchedule";
import {
  getClosestStationWithMargin,
  isClosestStationConfident,
} from "@/lib/stationUtils";

/**
 * The rider tapped "Take this train" but is closest to a different station
 * than the one it leaves from:
 *  - `nearDestination`: closest to where it's going — the classic "forgot to
 *    swap stations for the ride home". Offer a swap.
 *  - `nearOtherStation`: closest to some other station. Offer leaving from it.
 */
export type BoardingLocationWarning =
  | { kind: "nearDestination" }
  | { kind: "nearOtherStation"; station: Station };

interface BoardingFix {
  lat: number;
  lng: number;
  /** Accuracy radius in meters; null when the platform omitted it. */
  accuracy: number | null;
}

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
 * Warn when the station closest to the rider isn't the one the train leaves
 * from. Silent when the fix is too coarse to tell which station is closest.
 */
export function checkBoardingLocation(
  fix: BoardingFix,
  from: Station,
  to: Station,
): BoardingLocationWarning | null {
  const { lat, lng, accuracy } = fix;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const closest = getClosestStationWithMargin(lat, lng);
  // The true position can sit up to `accuracy` away in any direction, which
  // can shrink the gap to the runner-up by twice that — so the gap has to
  // clear 2× the radius before we name a station.
  if (
    closest.station === from ||
    !isClosestStationConfident(
      closest.marginKm,
      accuracy == null ? null : 2 * accuracy,
    )
  ) {
    return null;
  }
  return closest.station === to
    ? { kind: "nearDestination" }
    : { kind: "nearOtherStation", station: closest.station };
}

/** A selected pair of stations. */
export interface Leg {
  from: Station;
  to: Station;
}

/** The leg a warning's fix switches to: swapped for `nearDestination`, else
 *  leaving from the station the rider is closest to. */
export function correctedLeg(
  warning: BoardingLocationWarning,
  from: Station,
  to: Station,
): Leg {
  return warning.kind === "nearDestination"
    ? { from: to, to: from }
    : { from: warning.station, to };
}
