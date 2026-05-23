import { useCallback, useEffect, useState } from "react";
import type { Station } from "@/types/smartSchedule";
import {
  REMINDER_CHANGED_EVENT,
  cancelReminder as cancelReminderLib,
  ensureNotificationPermission,
  listReminders,
  reminderIdFor,
  scheduleReminder as scheduleReminderLib,
  type DepartureReminder,
  type ReminderText,
} from "@/lib/departureReminder";
import { logger } from "@/lib/logger";

function notifyChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(REMINDER_CHANGED_EVENT));
}

export interface UseDepartureReminderArgs {
  tripNumber: number;
  fromStation: Station;
  toStation: Station;
  /** The trip's *scheduled* HH:MM departure — used as a stable id key that
   *  doesn't shift when realtime updates move the actual departure across
   *  a calendar boundary. */
  scheduledDepartureTime: string;
  /** Epoch ms of the train's departure from fromStation (live-aware). */
  departureAt: number;
}

export type SetReminderResult =
  | { ok: true }
  | { ok: false; reason: "permission" | "schedule-failed" };

export function useDepartureReminder({
  tripNumber,
  fromStation,
  toStation,
  scheduledDepartureTime,
  departureAt,
}: UseDepartureReminderArgs) {
  const id = reminderIdFor(tripNumber, scheduledDepartureTime);

  const [reminder, setReminder] = useState<DepartureReminder | null>(() =>
    listReminders().find((r) => r.id === id) ?? null
  );

  useEffect(() => {
    setReminder(listReminders().find((r) => r.id === id) ?? null);
    const handler = () => {
      setReminder(listReminders().find((r) => r.id === id) ?? null);
    };
    window.addEventListener(REMINDER_CHANGED_EVENT, handler);
    return () => window.removeEventListener(REMINDER_CHANGED_EVENT, handler);
  }, [id]);

  const setReminderForLead = useCallback(
    async (
      leadMinutes: number,
      text: ReminderText
    ): Promise<SetReminderResult> => {
      const granted = await ensureNotificationPermission();
      if (!granted) return { ok: false, reason: "permission" };

      const reminderAt = departureAt - leadMinutes * 60_000;
      const next: DepartureReminder = {
        id,
        tripNumber,
        fromStation,
        toStation,
        departureAt,
        reminderAt,
        leadMinutes,
        title: text.title,
        body: text.body,
      };
      try {
        await scheduleReminderLib(next);
      } catch (error) {
        logger.warn("Failed to schedule departure reminder", error);
        return { ok: false, reason: "schedule-failed" };
      }
      notifyChange();
      return { ok: true };
    },
    [departureAt, fromStation, id, toStation, tripNumber]
  );

  /**
   * Re-arm an existing reminder under the same id with a refreshed reminderAt
   * and updated body text. Used when the live departure time drifts (delay)
   * so the reminder still fires the right number of minutes before the
   * actual train. Silently no-ops on failure — we already had a working
   * reminder at the old time, so a failed re-arm is worse than nothing.
   */
  const reschedule = useCallback(
    async (text: ReminderText): Promise<void> => {
      if (!reminder) return;
      const newReminderAt = departureAt - reminder.leadMinutes * 60_000;
      if (
        newReminderAt === reminder.reminderAt &&
        text.title === reminder.title &&
        text.body === reminder.body
      ) {
        return;
      }
      const updated: DepartureReminder = {
        ...reminder,
        departureAt,
        reminderAt: newReminderAt,
        title: text.title,
        body: text.body,
      };
      try {
        await scheduleReminderLib(updated);
        notifyChange();
      } catch (error) {
        logger.warn("Failed to refresh departure reminder", error);
      }
    },
    [departureAt, reminder]
  );

  const cancel = useCallback(async () => {
    await cancelReminderLib(id);
    notifyChange();
  }, [id]);

  return { reminder, setReminderForLead, reschedule, cancel };
}
