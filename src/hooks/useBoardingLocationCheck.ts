import { useEffect, useRef, useState } from "react";
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
  /** Whether the sheet hosting the control is open. A check still waiting on
   *  the fix when it starts closing is dropped instead of acting behind it. */
  active: boolean;
}

/**
 * The location check in front of "Take this train": warns when the rider is
 * closest to a different station than the one the train leaves from — most
 * often a ride home planned without swapping the morning's stations. Silent without location access — it never
 * prompts — and for trains it doesn't apply to (see
 * shouldCheckBoardingLocation).
 */
export function useBoardingLocationCheck({
  from,
  to,
  departureAt,
  now,
  active,
}: BoardingLocationCheckInput) {
  const [checking, setChecking] = useState(false);
  const [warning, setWarning] = useState<BoardingLocationWarning | null>(null);
  const enabled =
    departureAt != null && shouldCheckBoardingLocation(departureAt, now);

  // Warm the fix while the sheet is open so the tap rarely waits on it.
  useEffect(() => {
    if (enabled) void getRecentLocationFix();
  }, [enabled]);

  // False once the sheet starts closing (it stays mounted while it animates
  // out) or unmounts, so a check that settles afterwards doesn't act.
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
    return () => {
      activeRef.current = false;
    };
  }, [active]);

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
    let found: BoardingLocationWarning | null = null;
    let timer = 0;
    try {
      const fix = await Promise.race([
        getRecentLocationFix(),
        new Promise<null>((resolve) => {
          timer = window.setTimeout(() => resolve(null), MAX_WAIT_MS);
        }),
      ]);
      found = fix && checkBoardingLocation(fix, from, to);
    } catch {
      // A failed check never blocks the tap — go ahead unchecked.
    } finally {
      window.clearTimeout(timer);
    }
    setChecking(false);
    // The sheet may have been closed while we waited; don't act behind it.
    if (!activeRef.current) return;
    if (found) setWarning(found);
    else proceed();
  };

  return { checking, warning, guard, dismiss: () => setWarning(null) };
}
