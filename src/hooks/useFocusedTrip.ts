import { useCallback, useEffect, useState } from "react";
import type { Station } from "@/types/smartSchedule";
import {
  FOCUSED_TRIP_CHANGED_EVENT,
  loadFocusedTrip,
  saveFocusedTrip,
  type FocusedTrip,
} from "@/lib/focusedTrip";
import { cancelNotification } from "@/lib/notificationScheduler";
import { reminderIdFor } from "@/lib/notificationId";
import {
  armAndPersistReminder,
  cancelReminderChannels,
  endFocusActivity,
  ensureActivityForFocus,
  notifyChange,
  reRegisterPushForFocus,
  startActivityForFocus,
  syncFocusedActivityContent,
} from "@/lib/liveActivityController";

export interface FocusTripInput {
  tripNumber: number;
  fromStation: Station;
  toStation: Station;
  scheduleType: "weekday" | "weekend";
  /** "YYYY-MM-DD" service day of the run. */
  serviceDate: string;
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
   *  reminder + Live Activity. Caller handles any "switch trains?"
   *  confirmation. */
  const focusTrip = useCallback(async (input: FocusTripInput) => {
    const prev = loadFocusedTrip();
    if (prev?.reminder) await cancelReminderChannels(prev.reminder);
    await endFocusActivity(prev);
    const next: FocusedTrip = {
      source: "user",
      tripNumber: input.tripNumber,
      fromStation: input.fromStation,
      toStation: input.toStation,
      scheduleType: input.scheduleType,
      serviceDate: input.serviceDate,
      reminder: null,
    };
    saveFocusedTrip(next);
    notifyChange();
    // After the focus is visible — the activity is an enhancement, so its
    // (async, gated) start must not delay the card/picker appearing.
    await startActivityForFocus(next);
  }, []);

  /** Arm (number) or disarm (null) the reminder. `departureAt` is the live-
   *  aware departure instant used to compute the fire time. */
  const setReminder = useCallback(
    async (
      leadMinutes: number | null,
      departureAt: number,
      text: ReminderText,
    ): Promise<SetReminderResult> => {
      const current = loadFocusedTrip();
      if (!current) return { ok: false, reason: "no-focus" };

      if (leadMinutes === null) {
        if (current.reminder) await cancelReminderChannels(current.reminder);
        const cleared: FocusedTrip = { ...current, reminder: null };
        saveFocusedTrip(cleared);
        notifyChange();
        // Refresh the push registration so the backend stops baking the (now
        // cancelled) leave-alarm countdown into its locked-screen pushes.
        await reRegisterPushForFocus(cleared);
        return { ok: true };
      }

      const notificationId = reminderIdFor(current.tripNumber, current.serviceDate);
      if (current.reminder && current.reminder.notificationId !== notificationId) {
        await cancelNotification(current.reminder.notificationId);
      }
      // Intended fire time, kept UNCLAMPED. The near-now buffer is enforced on
      // the picker slider (it can't select a sub-buffer lead); clamping here with
      // Date.now() instead makes the value non-deterministic and spins the
      // drift-reschedule effect into a re-arm loop (its idempotency check
      // recomputes this same unclamped expression).
      const reminderAt = departureAt - leadMinutes * 60_000;
      // armAndPersistReminder picks the channel (alarm vs notification) and
      // requests notification permission only if it actually falls back, so an
      // alarm-only user who denied notifications isn't blocked here.
      const result = await armAndPersistReminder(
        current,
        { leadMinutes, reminderAt, notificationId, title: text.title, body: text.body },
        "Failed to schedule focused-trip reminder",
      );
      // A set reminder forces the Live Activity on — ensure it's running (covers
      // a far-ahead focus and recovers a dismissal). Fire-and-forget, like focus.
      if (result.ok) {
        const latest = loadFocusedTrip();
        if (latest) void ensureActivityForFocus(latest);
      }
      return result;
    },
    [],
  );

  /** Reschedule the armed reminder when the live departure drifts. No-op when
   *  there's no reminder or the fire time/text is unchanged. */
  const rescheduleReminder = useCallback(
    async (departureAt: number, text: ReminderText): Promise<void> => {
      const current = loadFocusedTrip();
      if (!current?.reminder) return;
      // Never re-arm a reminder that already fired — its `reminderAt` is now in
      // the past, and rescheduling to a past time would either be rejected
      // (AlarmKit) or fire the fallback notification immediately.
      if (current.reminder.firedAt != null) return;
      // Unclamped, to match DepartureReminder's drift short-circuit (see the
      // note in setReminder) — never reintroduce a Date.now() clamp here.
      const reminderAt = departureAt - current.reminder.leadMinutes * 60_000;
      if (
        reminderAt === current.reminder.reminderAt &&
        text.title === current.reminder.title &&
        text.body === current.reminder.body
      ) {
        return;
      }
      const { notificationId, leadMinutes } = current.reminder;
      // Re-arm under the SAME id, which atomically replaces the existing
      // notification (native overwrites same-id; web's armWebTimer clears the
      // prior timer first). Crucially armAndPersistReminder does NOT cancel
      // first: if scheduling throws (permission revoked, exact-alarm denied),
      // the original reminder is still armed, so a failed drift-reschedule
      // degrades to "fires at the old time" rather than silently vanishing.
      await armAndPersistReminder(
        current,
        { leadMinutes, reminderAt, notificationId, title: text.title, body: text.body },
        "Failed to reschedule focused-trip reminder on drift",
      );
    },
    [],
  );

  /**
   * Push the live departure/arrival/delay into the running Live Activity so
   * the lock-screen / Dynamic Island countdown tracks realtime drift and the
   * pre-departure → en-route phase flip. Independent of any armed reminder —
   * the activity follows the focused train itself. No-op when no activity is
   * running, and deduped against the last sent content so the RT poll / clock
   * tick can call this freely.
   */
  const updateLiveActivity = useCallback(
    (args: {
      departureAt: number;
      arrivalAt: number;
      delayMinutes: number | null;
      nextStop?: string | null;
      remainingStops?: number | null;
      isCanceled?: boolean;
    }): Promise<void> => syncFocusedActivityContent(args),
    [],
  );

  const clearFocusedTrip = useCallback(async () => {
    const current = loadFocusedTrip();
    if (current?.reminder) await cancelReminderChannels(current.reminder);
    await endFocusActivity(current);
    saveFocusedTrip(null);
    notifyChange();
  }, []);

  return {
    focusedTrip,
    focusTrip,
    setReminder,
    rescheduleReminder,
    updateLiveActivity,
    clearFocusedTrip,
  };
}
