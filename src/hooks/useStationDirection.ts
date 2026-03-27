import { useMemo } from "react";
import type { Station } from "@/types/smartSchedule";
import { isSouthbound } from "@/lib/stationUtils";

export interface StationDirection {
  direction: "southbound" | "northbound";
  isSouthbound: boolean;
  isNorthbound: boolean;
}

/**
 * Hook to determine the direction of travel between two stations
 */
export function useStationDirection(
  fromStation: Station | "",
  toStation: Station | ""
): StationDirection | null {
  return useMemo(() => {
    if (!fromStation || !toStation) return null;

    const sb = isSouthbound(fromStation, toStation);

    return {
      direction: sb ? "southbound" : "northbound",
      isSouthbound: sb,
      isNorthbound: !sb,
    };
  }, [fromStation, toStation]);
}
