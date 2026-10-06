import { useEffect, useRef, useState } from "react";
import { useStationSelection } from "@/contexts/stationSelection";
import { getRecentLocationFix } from "@/hooks/useGeolocation";
import {
  checkBoardingLocation,
  shouldCheckBoardingLocation,
  type BoardingLocationWarning,
} from "@/lib/boardingLocation";
import type { Station } from "@/types/smartSchedule";

/** Longest a tap waits on the fix before going ahead unchecked. */
const MAX_WAIT_MS = 3000;

interface BoardingLocationCheckInput {
  /** The leg about to be focused. */
  from: Station;
  to: Station;
  /** When the train leaves `from`; null to skip the check (e.g. not the
   *  rider's own leg). */
  departureAt: number | null;
  now: number;
}

/**
 * The location check in front of "Take this train": catches a ride home
 * planned without swapping the morning's stations, or a trip leaving from a
 * station the rider isn't at. Silent without location access — it never
 * prompts — and for trains it doesn't apply to (see
 * shouldCheckBoardingLocation).
 */
export function useBoardingLocationCheck({
  from,
  to,
  departureAt,
  now,
}: BoardingLocationCheckInput) {
  const { swapStations, setFromStation, setSelectedTrip } = useStationSelection();
  const [checking, setChecking] = useState(false);
  const [warning, setWarning] = useState<BoardingLocationWarning | null>(null);
  const enabled =
    departureAt != null && shouldCheckBoardingLocation(departureAt, now);

  // Warm the fix while the sheet is open so the tap rarely waits on it.
  useEffect(() => {
    if (enabled) void getRecentLocationFix();
  }, [enabled]);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Run `proceed`, unless the rider's location says they aren't leaving from
   *  `from` — then show the warning instead. No fix (no access, GPS slow or
   *  off) → proceed unchecked. */
  const guard = async (proceed: () => void) => {
    if (!enabled) {
      proceed();
      return;
    }
    if (checking) return;
    setChecking(true);
    let timer = 0;
    const fix = await Promise.race([
      getRecentLocationFix(),
      new Promise<null>((resolve) => {
        timer = window.setTimeout(() => resolve(null), MAX_WAIT_MS);
      }),
    ]);
    window.clearTimeout(timer);
    // The sheet may have been closed while we waited; don't act behind it.
    if (!mountedRef.current) return;
    setChecking(false);
    const found = fix && checkBoardingLocation(fix, from, to);
    if (found) setWarning(found);
    else proceed();
  };

  /** Correct the trip instead of taking this train — it runs the wrong way
   *  (or from the wrong station) — then close the sheet so the rider picks
   *  from the corrected schedule. */
  const fixTrip = () => {
    if (warning?.kind === "nearDestination") swapStations();
    else if (warning) setFromStation(warning.station);
    setWarning(null);
    setSelectedTrip(null);
  };

  return { checking, warning, guard, fixTrip, dismiss: () => setWarning(null) };
}
