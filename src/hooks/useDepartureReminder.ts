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

function notifyChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(REMINDER_CHANGED_EVENT));
}

export interface UseDepartureReminderArgs {
  tripNumber: number;
  fromStation: Station;
  toStation: Station;
  /** Epoch ms of the train's departure from fromStation. */
  departureAt: number;
}

export interface SetReminderResult {
  granted: boolean;
}

export function useDepartureReminder({
  tripNumber,
  fromStation,
  toStation,
  departureAt,
}: UseDepartureReminderArgs) {
  const id = reminderIdFor(tripNumber, departureAt);

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
    async (leadMinutes: number, text: ReminderText): Promise<SetReminderResult> => {
      const granted = await ensureNotificationPermission();
      if (!granted) return { granted: false };

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
      await scheduleReminderLib(next);
      notifyChange();
      return { granted: true };
    },
    [departureAt, fromStation, id, toStation, tripNumber]
  );

  const cancel = useCallback(async () => {
    await cancelReminderLib(id);
    notifyChange();
  }, [id]);

  return { reminder, setReminderForLead, cancel };
}
