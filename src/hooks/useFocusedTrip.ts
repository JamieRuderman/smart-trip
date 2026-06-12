import { useCallback, useEffect, useState } from "react";
import type { Station } from "@/types/smartSchedule";
import {
  FOCUSED_TRIP_CHANGED_EVENT,
  focusedArrivalInstant,
  focusedDepartureInstant,
  loadFocusedTrip,
  reconstructFocusedTrip,
  saveFocusedTrip,
  type FocusedTrip,
  type FocusedTripReminder,
} from "@/lib/focusedTrip";
import {
  cancelNotification,
  ensureNotificationPermission,
  scheduleNotification,
} from "@/lib/notificationScheduler";
import { cancelLeaveAlarm, scheduleLeaveAlarm } from "@/lib/native/leaveAlarm";
import {
  buildContentState,
  endTripActivity,
  listTripActivities,
  startTripActivity,
  tripActivityId,
  updateTripActivity,
  type TripActivityAttributes,
} from "@/lib/native/liveActivity";
import { shouldShowLiveActivity } from "@/lib/liveActivityContent";
import {
  deregisterPushActivity,
  isLiveActivityPushEnabled,
  registerPushActivity,
  startAndRegisterPushActivity,
} from "@/lib/native/liveActivityPush";
import type { LiveActivityRegistration } from "@/lib/liveActivityPushTypes";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import { isSouthbound } from "@/lib/stationUtils";
import { reminderIdFor } from "@/lib/notificationId";
import { logger } from "@/lib/logger";
import i18n from "@/lib/i18n";

function notifyChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(FOCUSED_TRIP_CHANGED_EVENT));
}

/** Cancel both channels a reminder might own — the local notification and, if
 *  it was scheduled as a true Leave Alarm, the AlarmKit alarm. Cancelling the
 *  channel that wasn't used is a harmless no-op. */
async function cancelReminderChannels(
  reminder: FocusedTripReminder | null,
): Promise<void> {
  if (!reminder) return;
  await cancelNotification(reminder.notificationId);
  if (reminder.alarmId) await cancelLeaveAlarm(reminder.alarmId);
}

/** Web-fire cleanup: drop only the reminder sub-object, keep the focus. */
function onReminderFired(): void {
  const after = loadFocusedTrip();
  if (after) saveFocusedTrip({ ...after, reminder: null });
  notifyChange();
}

type ArmResult = { ok: true } | { ok: false; reason: "permission" | "schedule-failed" };

/** Whether two focused trips are the same run (identity, ignoring the reminder
 *  sub-object). Used to detect a focus change that happened while we awaited a
 *  permission prompt, so we don't clobber it. */
function sameFocusIdentity(
  a: FocusedTrip | null,
  b: FocusedTrip | null,
): boolean {
  return (
    a != null &&
    b != null &&
    a.tripNumber === b.tripNumber &&
    a.serviceDate === b.serviceDate &&
    a.fromStation === b.fromStation &&
    a.toStation === b.toStation &&
    a.scheduleType === b.scheduleType
  );
}

/** Last content state sent per activity id — skips redundant plugin round-trips
 *  when the sync effect re-fires with unchanged data (RT poll, clock ticks). */
const lastSentActivityContent = new Map<string, string>();

/** Best-effort end of the focused trip's Live Activity (lock screen / Dynamic
 *  Island), if one is running. Also deregisters it from the push backend when
 *  push updates are enabled. Safe no-op everywhere else. */
async function endFocusActivity(focused: FocusedTrip | null): Promise<void> {
  if (!focused?.liveActivityId) return;
  lastSentActivityContent.delete(focused.liveActivityId);
  await endTripActivity(focused.liveActivityId);
  if (isLiveActivityPushEnabled()) {
    await deregisterPushActivity(focused.liveActivityId);
  }
}

/**
 * Origin-terminal scheduled departure ("HH:MM", markers stripped) — matches
 * the GTFS-RT feed's `startTime`, which is how the backend recognizes a
 * cancelled run whose stop updates were omitted. Southbound runs originate at
 * the northernmost station (times[0]), northbound at the southernmost
 * (times[last]) — same convention as useTripRealtimeStatusMap. Undefined when
 * the origin time isn't in the static data (trip starts mid-line).
 */
function originStartTimeFor(
  trip: ProcessedTrip,
  southbound: boolean,
): string | undefined {
  const raw = southbound ? trip.times[0] : trip.times[trip.times.length - 1];
  const cleaned = raw?.replace(/[*~]/g, "");
  return cleaned && cleaned !== "--" ? cleaned : undefined;
}

/** The push-backend registration for a focus under activity id `id`, or null
 *  when the trip can't be reconstructed. Shared by the start path and the
 *  boot-time re-registration heal. */
function buildRegistrationForFocus(
  saved: FocusedTrip,
  id: string,
): LiveActivityRegistration | null {
  const trip = reconstructFocusedTrip(saved);
  const departureAt = focusedDepartureInstant(saved);
  const arrivalAt = focusedArrivalInstant(saved);
  if (!trip || departureAt == null || arrivalAt == null) return null;
  const southbound = isSouthbound(saved.fromStation, saved.toStation);
  const originStartTime = originStartTimeFor(trip, southbound);
  return {
    id,
    tripNumber: saved.tripNumber,
    serviceDate: saved.serviceDate,
    fromStation: saved.fromStation,
    toStation: saved.toStation,
    direction: southbound ? "southbound" : "northbound",
    scheduledDeparture: trip.departureTime,
    scheduledArrival: trip.arrivalTime,
    departureEpochMs: departureAt,
    arrivalEpochMs: arrivalAt,
    ...(originStartTime ? { originStartTime } : {}),
  };
}

/**
 * Start the iOS Live Activity (lock screen + Dynamic Island countdown) for a
 * freshly saved focus and persist its id. Targets come from the static
 * schedule + serviceDate — the drift sync corrects them from realtime later.
 * Graceful no-op off-iOS / <16.2 / activities disabled (startTripActivity
 * gates internally). Mirrors armAndPersistReminder's commit discipline: after
 * the (async) start, the focus is re-read and the activity is rolled back if
 * the user switched/cleared trips meanwhile; on commit we persist from the
 * LATEST record so a concurrently armed reminder isn't clobbered.
 */
async function startActivityForFocus(saved: FocusedTrip): Promise<void> {
  const departureAt = focusedDepartureInstant(saved);
  const arrivalAt = focusedArrivalInstant(saved);
  if (departureAt == null || arrivalAt == null) return;
  // Only show within the departure window / when a reminder is armed / en route
  // — a far-ahead focus stays dormant rather than parking a Live Activity on the
  // lock screen for hours. Re-evaluated by reconcile + the reminder-arm path.
  if (
    !shouldShowLiveActivity({
      hasReminder: saved.reminder != null,
      departureEpochMs: departureAt,
      arrivalEpochMs: arrivalAt,
      now: Date.now(),
    })
  ) {
    return;
  }
  const id = tripActivityId(saved.tripNumber, saved.serviceDate);
  const attributes: TripActivityAttributes = {
    tripNumber: saved.tripNumber,
    fromStation: saved.fromStation,
    toStation: saved.toStation,
    routeName: "SMART",
    direction: isSouthbound(saved.fromStation, saved.toStation)
      ? "southbound"
      : "northbound",
  };
  const content = buildContentState({
    departureEpochMs: departureAt,
    arrivalEpochMs: arrivalAt,
    delayMinutes: null,
    nextStop: null,
    remainingStops: null,
    isCanceled: false,
    isEnded: false,
    now: Date.now(),
  });
  // Push-enabled builds register the trip + APNs token with the backend so the
  // countdown is corrected while the phone is locked; everything else uses the
  // local-only start. Both gate internally (off-iOS / <16.2 / disabled).
  let started: boolean;
  if (isLiveActivityPushEnabled()) {
    const registration = buildRegistrationForFocus(saved, id);
    started = registration
      ? (await startAndRegisterPushActivity(registration, attributes, content)).started
      : (await startTripActivity(id, attributes, content)).started;
  } else {
    started = (await startTripActivity(id, attributes, content)).started;
  }
  if (!started) return;
  lastSentActivityContent.set(id, JSON.stringify(content));
  const latest = loadFocusedTrip();
  if (latest == null || !sameFocusIdentity(latest, saved)) {
    lastSentActivityContent.delete(id);
    await endTripActivity(id);
    return;
  }
  saveFocusedTrip({ ...latest, liveActivityId: id });
  notifyChange();
}

/**
 * Start the focused trip's Live Activity if it isn't already on screen and it
 * should be (within the departure window, a reminder is armed, or en route).
 * Deduped against the OS's live list, so it never double-starts; it DOES bring
 * one back once eligible — covering a far-ahead focus that just entered the
 * window and recovering an activity the user dismissed. `startActivityForFocus`
 * self-gates, so this is a no-op while the trip is still dormant.
 */
export async function ensureActivityForFocus(focused: FocusedTrip): Promise<void> {
  const running = await listTripActivities();
  if (focused.liveActivityId && running.includes(focused.liveActivityId)) return;
  await startActivityForFocus(focused);
}

/**
 * Boot/foreground reconciliation, two-way. (1) End any OS-side Live Activity
 * that no longer belongs to the current focus — a stale focus auto-cleared by
 * `loadFocusedTrip` (arrival passed, timetable changed) leaves its activity
 * orphaned on the lock screen since the storage layer can't reach the plugin.
 * (2) Self-heal the opposite gap: a focus with NO committed activity (start
 * failed, app killed between start and commit, or Live Activities were
 * disabled when the trip was focused and enabled since) gets a fresh start —
 * `startActivityForFocus` re-gates internally, so attempting every boot is
 * safe. A user-dismissed activity is NOT respawned: swiping it away leaves
 * `liveActivityId` committed, which skips the heal. Instant no-op off-iOS.
 * Call alongside `bootFocusedTrip`.
 */
export async function reconcileTripActivities(): Promise<void> {
  const focused = loadFocusedTrip();
  const keep = focused?.liveActivityId;
  const ids = await listTripActivities();
  await Promise.all(
    ids.filter((id) => id !== keep).map((id) => endTripActivity(id)),
  );
  const running = keep != null && ids.includes(keep);
  if (focused && !running) {
    // Nothing on screen for this focus (never started, ended, or the user
    // dismissed it) — (re)start if it should show now. startActivityForFocus
    // self-gates on the window/reminder/riding rule, so a far-ahead focus with
    // no reminder stays dormant; a dismissed-but-eligible one comes back.
    await startActivityForFocus(focused);
    return;
  }
  // Push heal: the running activity's registration POST may have failed at
  // focus time (offline), silently degrading locked-screen corrections.
  // Re-registering is an idempotent upsert keyed on the activity id (and
  // refreshes the server-side TTLs), so re-POST on every boot.
  if (focused?.liveActivityId && isLiveActivityPushEnabled()) {
    const registration = buildRegistrationForFocus(
      focused,
      focused.liveActivityId,
    );
    if (registration) await registerPushActivity(registration);
  }
}

/**
 * Schedule `reminder` on the best available channel and, on success, persist it
 * onto the focused trip and notify consumers. Shared by the arm + drift-
 * reschedule paths.
 *
 * Prefers a true AlarmKit "Leave Alarm" on iOS (it breaks through Silent
 * Mode/Focus), falling back to a local notification everywhere else (Android,
 * web, AlarmKit unavailable/denied/off-day, or a create failure). The alarm
 * REPLACES the notification — never both, so the user gets a single alert.
 * Notification permission is requested ONLY on the fallback path, so an
 * alarm-only user who denied notifications can still get a Leave Alarm.
 *
 * The new channel is always scheduled BEFORE the previous one is retired, so a
 * failed (re)schedule degrades to "fires on the old channel/time" rather than
 * silently vanishing. After scheduling, the focus is re-read: a permission
 * prompt can block long enough for the user to Stop / switch trains / the trip
 * to auto-clear, so if the focus changed we roll back the freshly scheduled
 * channel instead of resurrecting the stale trip.
 */
async function armAndPersistReminder(
  current: FocusedTrip,
  reminder: FocusedTripReminder,
  failureMessage: string,
): Promise<ArmResult> {
  const prev = current.reminder;

  const alarm = await scheduleLeaveAlarm({
    label: reminder.title,
    fireAt: reminder.reminderAt,
    // Module code (not a component) — use the global i18n instance for the
    // alert's button labels; the title/body already arrive localized.
    buttons: {
      stop: i18n.t("departureReminder.alarmStop"),
      viewTrip: i18n.t("departureReminder.alarmViewTrip"),
    },
  });
  const alarmId = alarm.scheduled ? alarm.alarmId : undefined;

  if (!alarmId) {
    const granted = await ensureNotificationPermission();
    if (!granted) return { ok: false, reason: "permission" };
    try {
      await scheduleNotification(
        {
          id: reminder.notificationId,
          title: reminder.title,
          body: reminder.body,
          at: reminder.reminderAt,
        },
        onReminderFired,
      );
    } catch (error) {
      logger.warn(failureMessage, error);
      return { ok: false, reason: "schedule-failed" };
    }
  }

  // Commit only if the focus is still the same run we scheduled for.
  const latest = loadFocusedTrip();
  if (latest == null || !sameFocusIdentity(latest, current)) {
    if (alarmId) await cancelLeaveAlarm(alarmId);
    else await cancelNotification(reminder.notificationId);
    return { ok: false, reason: "schedule-failed" };
  }

  // Retire the previous channel now that the replacement is committed.
  if (alarmId) {
    if (prev?.alarmId && prev.alarmId !== alarmId) await cancelLeaveAlarm(prev.alarmId);
    // Drop any stale notification under this id so we don't double-alert.
    await cancelNotification(reminder.notificationId);
  } else if (prev?.alarmId) {
    await cancelLeaveAlarm(prev.alarmId);
  }
  // Persist from `latest` (same identity as `current`, just re-read): the
  // Live Activity start commits `liveActivityId` concurrently with this
  // await-heavy path, and spreading the stale `current` would clobber it.
  saveFocusedTrip({ ...latest, reminder: { ...reminder, alarmId } });
  notifyChange();
  return { ok: true };
}

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
        saveFocusedTrip({ ...current, reminder: null });
        notifyChange();
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
    async (args: {
      departureAt: number;
      arrivalAt: number;
      delayMinutes: number | null;
      nextStop?: string | null;
      remainingStops?: number | null;
      isCanceled?: boolean;
    }): Promise<void> => {
      const current = loadFocusedTrip();
      const id = current?.liveActivityId;
      if (!id) return;
      const content = buildContentState({
        departureEpochMs: args.departureAt,
        arrivalEpochMs: args.arrivalAt,
        delayMinutes: args.delayMinutes,
        nextStop: args.nextStop ?? null,
        remainingStops: args.remainingStops ?? null,
        isCanceled: args.isCanceled ?? false,
        isEnded: false,
        now: Date.now(),
      });
      const json = JSON.stringify(content);
      if (lastSentActivityContent.get(id) === json) return;
      const { updated } = await updateTripActivity(id, content);
      if (updated) lastSentActivityContent.set(id, json);
    },
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
