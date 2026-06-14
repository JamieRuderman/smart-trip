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
  /** Whether the lead-time reminder modal is open. Lifted to context so the
   *  in-sheet "Take this train" control can pop it after closing its own sheet,
   *  and so the modal survives that sheet unmounting. */
  reminderDialogOpen: boolean;
  openReminderDialog: () => void;
  closeReminderDialog: () => void;
  focusedTrip: FocusedTrip | null;
  focusTrip: (input: FocusTripInput) => Promise<void>;
  setReminder: (
    leadMinutes: number | null,
    departureAt: number,
    text: ReminderText,
  ) => Promise<SetReminderResult>;
  rescheduleReminder: (departureAt: number, text: ReminderText) => Promise<void>;
  /** Push live departure/arrival/delay into the focused trip's iOS Live
   *  Activity (no-op when none is running — non-iOS, unsupported, off). */
  updateLiveActivity: (args: {
    departureAt: number;
    arrivalAt: number;
    delayMinutes: number | null;
    nextStop?: string | null;
    remainingStops?: number | null;
    isCanceled?: boolean;
  }) => Promise<void>;
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
