import { createContext, useContext } from "react";
import type { Station } from "@/types/smartSchedule";

export interface StationSelection {
  fromStation: Station | "";
  toStation: Station | "";
  scheduleType: "weekday" | "weekend";
  selectedTripNumber: number | null;
  setFromStation: (station: Station | "") => void;
  setToStation: (station: Station | "") => void;
  swapStations: () => void;
  setScheduleType: (type: "weekday" | "weekend") => void;
  setSelectedTrip: (tripNumber: number | null) => void;
}

export const StationSelectionContext = createContext<StationSelection | null>(
  null,
);

export function useStationSelection(): StationSelection {
  const ctx = useContext(StationSelectionContext);
  if (!ctx) {
    throw new Error(
      "useStationSelection must be used within a StationSelectionProvider",
    );
  }
  return ctx;
}
