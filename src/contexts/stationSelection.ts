import { createContext, useContext } from "react";
import type { Station } from "@/types/smartSchedule";
import type { FocusedTrip } from "@/lib/focusedTrip";
import type {
  FocusTripInput,
  ReminderText,
  SetReminderResult,
} from "@/hooks/useFocusedTrip";

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
  focusedTrip: FocusedTrip | null;
  focusTrip: (input: FocusTripInput) => Promise<void>;
  setReminder: (
    leadMinutes: number | null,
    text: ReminderText,
  ) => Promise<SetReminderResult>;
  refreshFocusedTimes: (
    departureAt: number,
    arrivalAt: number,
    text: ReminderText,
  ) => Promise<void>;
  clearFocusedTrip: () => Promise<void>;
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
