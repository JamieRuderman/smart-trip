import { createContext, useContext } from "react";
import type { Station } from "@/types/smartSchedule";
import type { Place } from "@/lib/places";
import type { FocusedTrip } from "@/lib/focusedTrip";
import type { syncFocusedActivityContent } from "@/lib/liveActivityController";
import type {
  FocusTripInput,
  ReminderText,
  SetReminderResult,
} from "@/hooks/useFocusedTrip";

/** A train the trip page shows before (or without) it being taken: its run
 *  between two places on one schedule. */
export interface PreviewTrip {
  tripNumber: number;
  from: Place;
  to: Place;
  scheduleType: "weekday" | "weekend";
}

export interface StationSelection {
  /** The ends the rider picked, San Francisco included. */
  fromPlace: Place | "";
  toPlace: Place | "";
  /** The SMART stations the train leg runs between (Larkspur for San
   *  Francisco). */
  fromStation: Station | "";
  toStation: Station | "";
  /** One end is San Francisco, so the leg rides the ferry at Larkspur. */
  viaFerry: boolean;
  scheduleType: "weekday" | "weekend";
  /** Local date ("YYYY-MM-DD") the schedule type was last picked, chosen or
   *  confirmed, so the switch prompt asks at most once a day. */
  scheduleCheckedOn: string;
  confirmScheduleCheckedOn: (date: string) => void;
  previewTrip: PreviewTrip | null;
  setFromStation: (place: Place | "") => void;
  setToStation: (place: Place | "") => void;
  swapStations: () => void;
  setScheduleType: (type: "weekday" | "weekend") => void;
  setPreviewTrip: (trip: PreviewTrip | null) => void;
  /** Whether the "stations updated, pick a time" notice is open — at the app
   *  root, so it outlives the trip view whose location fix switched the
   *  stations. */
  stationsUpdatedOpen: boolean;
  openStationsUpdated: () => void;
  closeStationsUpdated: () => void;
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
  updateLiveActivity: typeof syncFocusedActivityContent;
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
