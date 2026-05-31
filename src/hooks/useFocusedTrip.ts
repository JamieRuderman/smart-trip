import { useCallback, useEffect, useState } from "react";
import type { Station } from "@/types/smartSchedule";
import {
  FOCUSED_TRIP_CHANGED_EVENT,
  loadFocusedTrip,
  saveFocusedTrip,
  type FocusedTrip,
} from "@/lib/focusedTrip";
import {
  cancelNotification,
  ensureNotificationPermission,
  scheduleNotification,
  type ScheduledNotification,
} from "@/lib/notificationScheduler";
import { reminderIdFor } from "@/lib/notificationId";
import { logger } from "@/lib/logger";

function notifyChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(FOCUSED_TRIP_CHANGED_EVENT));
}

export interface FocusTripInput {
  tripNumber: number;
  fromStation: Station;
  toStation: Station;
  scheduleType: "weekday" | "weekend";
  /** Scheduled HH:MM departure — stable id key across midnight drift. */
  scheduledDepartureTime: string;
  departureAt: number;
  arrivalAt: number;
}

export type SetReminderResult =
  | { ok: true }
  | { ok: false; reason: "permission" | "schedule-failed" | "no-focus" };

export interface ReminderText {
  title: string;
  body: string;
}

export function useFocusedTrip() {
  const [focusedTrip, setFocusedTripState] = useState<FocusedTrip | null>(() =>
    loadFocusedTrip(),
  );

  useEffect(() => {
    const handler = () => setFocusedTripState(loadFocusedTrip());
    window.addEventListener(FOCUSED_TRIP_CHANGED_EVENT, handler);
    return () => window.removeEventListener(FOCUSED_TRIP_CHANGED_EVENT, handler);
  }, []);

  /** Focus a trip (no reminder). Replaces any existing focus and cancels its
   *  reminder. Caller is responsible for any "switch trains?" confirmation. */
  const focusTrip = useCallback(async (input: FocusTripInput) => {
    const prev = loadFocusedTrip();
    if (prev?.reminder) {
      await cancelNotification(reminderIdFor(prev.tripNumber, prev.departureAt));
    }
    const next: FocusedTrip = {
      source: "user",
      tripNumber: input.tripNumber,
      fromStation: input.fromStation,
      toStation: input.toStation,
      scheduleType: input.scheduleType,
      departureAt: input.departureAt,
      arrivalAt: input.arrivalAt,
      reminder: null,
    };
    saveFocusedTrip(next);
    notifyChange();
  }, []);

  /** Arm (number) or disarm (null) the reminder on the current focused trip. */
  const setReminder = useCallback(
    async (
      leadMinutes: number | null,
      text: ReminderText,
    ): Promise<SetReminderResult> => {
      const current = loadFocusedTrip();
      if (!current) return { ok: false, reason: "no-focus" };
      const id = reminderIdFor(current.tripNumber, current.departureAt);

      if (leadMinutes === null) {
        await cancelNotification(id);
        saveFocusedTrip({ ...current, reminder: null });
        notifyChange();
        return { ok: true };
      }

      const granted = await ensureNotificationPermission();
      if (!granted) return { ok: false, reason: "permission" };

      const reminderAt = current.departureAt - leadMinutes * 60_000;
      const notification: ScheduledNotification = {
        id,
        title: text.title,
        body: text.body,
        at: reminderAt,
      };
      try {
        await scheduleNotification(notification, () => {
          const after = loadFocusedTrip();
          if (after) saveFocusedTrip({ ...after, reminder: null });
          notifyChange();
        });
      } catch (error) {
        logger.warn("Failed to schedule focused-trip reminder", error);
        return { ok: false, reason: "schedule-failed" };
      }
      saveFocusedTrip({
        ...current,
        reminder: { leadMinutes, reminderAt, title: text.title, body: text.body },
      });
      notifyChange();
      return { ok: true };
    },
    [],
  );

  const clearFocusedTrip = useCallback(async () => {
    const current = loadFocusedTrip();
    if (current?.reminder) {
      await cancelNotification(reminderIdFor(current.tripNumber, current.departureAt));
    }
    saveFocusedTrip(null);
    notifyChange();
  }, []);

  return { focusedTrip, focusTrip, setReminder, clearFocusedTrip };
}
