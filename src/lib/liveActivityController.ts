/**
 * Live Activity controller — the focused trip's iOS Live Activity (lock screen +
 * Dynamic Island) lifecycle: start/revive/end, push-backend registration, the
 * boot/foreground reconcile, and reminder (leave-alarm) scheduling.
 *
 * These are plain module functions (no React) extracted from `useFocusedTrip`
 * so the hook stays a thin state wrapper. The per-activity dedup maps
 * (`lastSentActivityContent`, `lastSentRegistration`) live here and are private
 * to this module, shared by the start/refresh/sync paths.
 */
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
  isTripActivityRunning,
  listTripActivityRecords,
  scheduleTripActivity,
  startTripActivity,
  tripActivityId,
  updateTripActivity,
  type TripActivityAttributes,
  type TripActivityRecord,
} from "@/lib/native/liveActivity";
import {
  liveActivityStartAt,
  shouldShowLiveActivity,
} from "@/lib/liveActivityContent";
import {
  configureLiveActivityTokenEndpoint,
  deregisterPushActivity,
  isLiveActivityPushEnabled,
  registerPushActivity,
  startAndRegisterPushActivity,
} from "@/lib/native/liveActivityPush";
import type { LiveActivityRegistration } from "@/lib/liveActivityPushTypes";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import { isSouthbound } from "@/lib/stationUtils";
import { cleanTimeString } from "@/lib/timeUtils";
import { logger } from "@/lib/logger";
import i18n from "@/lib/i18n";

export function notifyChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(FOCUSED_TRIP_CHANGED_EVENT));
}

/** Cancel both channels a reminder might own — the local notification and, if
 *  it was scheduled as a true Leave Alarm, the AlarmKit alarm. Cancelling the
 *  channel that wasn't used is a harmless no-op. */
export async function cancelReminderChannels(
  reminder: FocusedTripReminder | null,
): Promise<void> {
  if (!reminder) return;
  await cancelNotification(reminder.notificationId);
  if (reminder.alarmId) await cancelLeaveAlarm(reminder.alarmId);
}

/** Web-fire cleanup: stamp the reminder as fired (keeps the focus + lead so the
 *  card can show a "time to go" indicator), rather than dropping it. */
function onReminderFired(): void {
  const after = loadFocusedTrip();
  if (after?.reminder) {
    saveFocusedTrip({
      ...after,
      reminder: { ...after.reminder, firedAt: Date.now() },
    });
  }
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

/** Last registration POSTed per activity id — only refreshed on a confirmed-OK
 *  POST, so a failed attempt isn't cached and re-registration retries on the
 *  next trigger. Keeps the self-healing re-register (below) from spamming the
 *  backend with identical payloads on every drift/delay sync tick. */
const lastSentRegistration = new Map<string, string>();

/** (Re-)POST a registration only when it differs from the last one the backend
 *  accepted for this activity. The backend bakes the armed reminder's lead into
 *  every locked-screen push, so it MUST hold the current lead or a delay push
 *  drops the "Leave in" stage — this is the safety net that re-asserts the lead
 *  if the arm-time POST was lost (offline) or raced the activity-id commit. */
async function postRegistrationDeduped(
  registration: LiveActivityRegistration,
): Promise<void> {
  const json = JSON.stringify(registration);
  if (lastSentRegistration.get(registration.id) === json) return;
  if (await registerPushActivity(registration)) {
    lastSentRegistration.set(registration.id, json);
  }
}

/** Best-effort end of the focused trip's Live Activity (lock screen / Dynamic
 *  Island), if one is running. Also deregisters it from the push backend when
 *  push updates are enabled. Safe no-op everywhere else. */
export async function endFocusActivity(focused: FocusedTrip | null): Promise<void> {
  if (!focused?.liveActivityId) return;
  lastSentActivityContent.delete(focused.liveActivityId);
  lastSentRegistration.delete(focused.liveActivityId);
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
  const cleaned = raw ? cleanTimeString(raw) : undefined;
  return cleaned && cleaned !== "--" ? cleaned : undefined;
}

/** Immutable widget attributes for a focus — identical on the start and the
 *  scheduled-start paths. */
function attributesFor(saved: FocusedTrip): TripActivityAttributes {
  return {
    tripNumber: saved.tripNumber,
    fromStation: saved.fromStation,
    toStation: saved.toStation,
    routeName: "SMART",
    direction: isSouthbound(saved.fromStation, saved.toStation)
      ? "southbound"
      : "northbound",
  };
}

/**
 * When this focus's Live Activity should appear on screen — one lead-time ahead
 * of the armed leave alarm, or of departure when no reminder is set. Null when
 * the departure instant can't be resolved. The scheduled start is pinned to
 * this, so it's also how {@link ensureActivityForFocus} detects that a re-armed
 * reminder moved the instant and the pending activity needs replacing.
 */
export function focusedActivityStartAt(focused: FocusedTrip): number | null {
  const departureAt = focusedDepartureInstant(focused);
  if (departureAt == null) return null;
  return liveActivityStartAt({
    reminderEpochMs: focused.reminder?.reminderAt ?? null,
    departureEpochMs: departureAt,
  });
}

/** The push-backend registration for a focus under activity id `id`, or null
 *  when the trip can't be reconstructed. Shared by the start path and the
 *  boot-time re-registration heal. `activityStartEpochMs` marks a registration
 *  filed ahead of a scheduled activity, so the backend sleeps until it; it
 *  defaults to the focus's own pinned instant so the re-register/heal paths
 *  can't silently drop it and wake the backend into a dormant poll loop. */
function buildRegistrationForFocus(
  saved: FocusedTrip,
  id: string,
  activityStartEpochMs: number | undefined = saved.liveActivityScheduledFor,
  timelineStartEpochMs: number | undefined = saved.liveActivityTimelineStart,
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
    // Carry the armed reminder's lead so the server can keep the leave-alarm
    // countdown alive across its locked-screen delay pushes (otherwise every
    // push would drop the "Leave in" stage back to "Departs in").
    ...(saved.reminder ? { reminderLeadMinutes: saved.reminder.leadMinutes } : {}),
    ...(activityStartEpochMs != null ? { activityStartEpochMs } : {}),
    ...(timelineStartEpochMs != null ? { timelineStartEpochMs } : {}),
  };
}

/**
 * Re-POST the focus's push registration so the backend learns the CURRENT
 * reminder state (armed lead, or none). The registration is otherwise written
 * only at activity start — but a reminder is armed/cleared/changed AFTER focus,
 * and the server bakes the leave-alarm countdown into every push from the
 * registered lead, so it must be refreshed whenever that lead changes. Idempotent
 * upsert keyed on the activity id; no-op off push builds or before an activity
 * has committed its id (the start path registers with the reminder included).
 */
export async function reRegisterPushForFocus(focused: FocusedTrip): Promise<void> {
  if (!isLiveActivityPushEnabled()) return;
  const id = focused.liveActivityId;
  if (!id) return;
  const registration = buildRegistrationForFocus(focused, id);
  if (registration) await postRegistrationDeduped(registration);
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
export async function startActivityForFocus(saved: FocusedTrip): Promise<void> {
  const departureAt = focusedDepartureInstant(saved);
  const arrivalAt = focusedArrivalInstant(saved);
  if (departureAt == null || arrivalAt == null) return;
  // Not showtime yet — a focus pinned hours out shouldn't park a countdown on
  // the lock screen all day. Hand the start to iOS instead of dropping it: the
  // OS brings the activity up at the right instant with the app closed.
  if (
    !shouldShowLiveActivity({
      reminderEpochMs: saved.reminder?.reminderAt ?? null,
      departureEpochMs: departureAt,
      arrivalEpochMs: arrivalAt,
      now: Date.now(),
    })
  ) {
    await scheduleActivityForFocus(saved, departureAt, arrivalAt);
    return;
  }
  const id = tripActivityId(saved.tripNumber, saved.serviceDate);
  const timelineStart = Date.now();
  const attributes = attributesFor(saved);
  const content = buildContentState({
    departureEpochMs: departureAt,
    arrivalEpochMs: arrivalAt,
    delayMinutes: null,
    nextStop: null,
    remainingStops: null,
    isCanceled: false,
    isEnded: false,
    reminderSet: saved.reminder != null,
    reminderEpochMs: saved.reminder?.reminderAt ?? null,
    timelineStartEpochMs: timelineStart,
    now: timelineStart,
  });
  // Push-enabled builds register the trip + APNs token with the backend so the
  // countdown is corrected while the phone is locked; everything else uses the
  // local-only start. Both gate internally (off-iOS / <16.2 / disabled).
  let started: boolean;
  if (isLiveActivityPushEnabled()) {
    const registration = buildRegistrationForFocus(
      saved,
      id,
      undefined,
      timelineStart,
    );
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
  // Drop `liveActivityScheduledFor`: this activity is running NOW, not pending,
  // so there's no future start instant left to compare against — leaving a stale
  // one would make `ensureActivityForFocus` think it still had a pending slot.
  const committed: FocusedTrip = {
    ...latest,
    liveActivityId: id,
    liveActivityTimelineStart: timelineStart,
  };
  delete committed.liveActivityScheduledFor;
  saveFocusedTrip(committed);
  notifyChange();
}

/**
 * Hand the focus's Live Activity to iOS with a FUTURE start date, so the OS
 * brings it up an hour before it's time to leave — with the app closed, which is
 * the normal case for a trip pinned in the morning for an evening train.
 *
 * ActivityKit's scheduled start is iOS 26+; below it `scheduleTripActivity`
 * no-ops and the activity simply starts the next time the app runs inside the
 * window (the leave alarm / reminder notification still fires on time either
 * way, since that's a separate AlarmKit/notification channel).
 *
 * The content state is built for the START instant, not for now — it's what
 * renders the moment the activity appears. Registration follows the same commit
 * discipline as {@link startActivityForFocus}: re-read the focus and roll the
 * pending activity back if the user switched trips while we awaited.
 */
async function scheduleActivityForFocus(
  saved: FocusedTrip,
  departureAt: number,
  arrivalAt: number,
): Promise<void> {
  const startAt = liveActivityStartAt({
    reminderEpochMs: saved.reminder?.reminderAt ?? null,
    departureEpochMs: departureAt,
  });
  const id = tripActivityId(saved.tripNumber, saved.serviceDate);
  const content = buildContentState({
    departureEpochMs: departureAt,
    arrivalEpochMs: arrivalAt,
    delayMinutes: null,
    nextStop: null,
    remainingStops: null,
    isCanceled: false,
    isEnded: false,
    reminderSet: saved.reminder != null,
    reminderEpochMs: saved.reminder?.reminderAt ?? null,
    timelineStartEpochMs: startAt,
    now: startAt,
  });
  const enablePush = isLiveActivityPushEnabled();
  // Point iOS at the token endpoint BEFORE handing it the activity: the token
  // is minted only when the OS starts it — likely with the app closed — and the
  // endpoint is persisted natively, so configuring it now is what lets that
  // future token reach the backend. (The immediate path does the same inside
  // startAndRegisterPushActivity.)
  if (enablePush) await configureLiveActivityTokenEndpoint();
  const { scheduled } = await scheduleTripActivity({
    id,
    attributes: attributesFor(saved),
    content,
    startAtEpochMs: startAt,
    // ActivityKit REQUIRES an alert for a scheduled start — iOS banners it when
    // the activity appears. Module code, so the global i18n instance (same as
    // armAndPersistReminder's alarm button labels).
    alert: {
      title: i18n.t("focusedTrip.activityStartTitle", { station: saved.fromStation }),
      body: i18n.t("focusedTrip.activityStartBody", { trip: saved.tripNumber }),
    },
    enablePush,
  });
  if (!scheduled) return;
  const latest = loadFocusedTrip();
  if (latest == null || !sameFocusIdentity(latest, saved)) {
    await endTripActivity(id);
    return;
  }
  saveFocusedTrip({
    ...latest,
    liveActivityId: id,
    liveActivityScheduledFor: startAt,
    liveActivityTimelineStart: startAt,
  });
  notifyChange();
  // Register now rather than at start: once the OS brings the activity up the
  // app may never run again before departure, so this is our only chance to set
  // up locked-screen delay correction. The backend sleeps until `startAt`
  // instead of polling through the dormant hours, and iOS POSTs the per-activity
  // token to the (natively persisted) token endpoint when the activity starts.
  if (enablePush) {
    const registration = buildRegistrationForFocus(saved, id, startAt, startAt);
    if (registration) await postRegistrationDeduped(registration);
  }
}

/**
 * Push the focused trip's CURRENT content to its already-running Live Activity,
 * so a just-armed/cleared/rescheduled reminder (the "leave alarm" stage) is
 * reflected on the lock screen + Dynamic Island immediately, instead of waiting
 * for the next `LiveActivitySync` drift tick. Mirrors `startActivityForFocus`'s
 * content build; deduped against the last-sent content. No-op when the activity
 * isn't running or its targets can't be resolved. Realtime delay isn't known
 * here (the next sync tick re-pushes it), matching the start path.
 */
async function refreshActivityContent(focused: FocusedTrip): Promise<void> {
  const id = focused.liveActivityId;
  if (!id) return;
  const departureAt = focusedDepartureInstant(focused);
  const arrivalAt = focusedArrivalInstant(focused);
  if (departureAt == null || arrivalAt == null) return;
  const timelineStart = focused.liveActivityTimelineStart ?? Date.now();
  if (focused.liveActivityTimelineStart == null) {
    saveFocusedTrip({ ...focused, liveActivityTimelineStart: timelineStart });
  }
  const content = buildContentState({
    departureEpochMs: departureAt,
    arrivalEpochMs: arrivalAt,
    delayMinutes: null,
    nextStop: null,
    remainingStops: null,
    isCanceled: false,
    isEnded: false,
    reminderSet: focused.reminder != null,
    reminderEpochMs: focused.reminder?.reminderAt ?? null,
    timelineStartEpochMs: timelineStart,
    now: Date.now(),
  });
  const json = JSON.stringify(content);
  if (lastSentActivityContent.get(id) === json) return;
  const { updated } = await updateTripActivity(id, content);
  if (updated) lastSentActivityContent.set(id, json);
}

/**
 * Start the focus's Live Activity, or REVIVE it when the only thing on screen is
 * the frozen `ended` activity we scheduled to auto-dismiss after arrival (the
 * local background self-clear path). An `ended` activity still renders but can no
 * longer be updated, so we end it and start a fresh, updatable one.
 *
 * No-op (returns false) when a LIVE activity already exists for the focus
 * (`active`/`stale`/`pending`), when the user swiped it away (`dismissed`), or
 * when a push build deliberately ended it server-side at arrival — none of those
 * should be respawned. Returns true when it (re)started one. `startActivityForFocus`
 * self-gates on the window/reminder/riding rule, so a dormant focus stays off.
 */
async function startOrReviveActivity(
  focused: FocusedTrip,
  records: TripActivityRecord[],
): Promise<boolean> {
  const keep = focused.liveActivityId;
  const kept = keep != null ? records.find((r) => r.id === keep) : undefined;
  // `Activity.request` can resolve before ActivityKit publishes the new item
  // through its global `.activities` inventory (observed on iOS 26.6). The
  // plugin already owns the returned Activity object under this logical id, so
  // trust that immediate per-id state during the inventory gap. Otherwise each
  // reminder/reconcile pass starts another replacement before the first Live
  // Activity has had a chance to appear.
  if (keep != null && kept == null && (await isTripActivityRunning(keep))) {
    return false;
  }
  // Push builds never schedule the local auto-dismiss (the cron ends the
  // activity server-side at live arrival), so there an `ended` activity is a
  // deliberate end — leave it be rather than resurrect it.
  const keptFrozen =
    kept != null && kept.state === "ended" && !isLiveActivityPushEnabled();
  // Already covered (live / user-dismissed / push-ended) — don't touch it.
  if (kept != null && !keptFrozen) return false;
  // End the frozen one first so its pending auto-dismissal can't remove the
  // freshly started activity.
  if (keptFrozen && keep != null) await endTripActivity(keep);
  await startActivityForFocus(focused);
  return true;
}

/**
 * Start the focused trip's Live Activity if it isn't already on screen and it
 * should be (within the departure window, a reminder is armed, or en route).
 * Deduped against the OS's live list by lifecycle state (see
 * {@link startOrReviveActivity}), so it never double-starts; it DOES bring one
 * back once eligible — covering a far-ahead focus that just entered the window,
 * and reviving the frozen `ended` activity left by the background auto-dismiss
 * before the next foreground reconcile runs (e.g. arming a reminder right after
 * returning to the app). When a live activity already covers the focus, its
 * content is refreshed so a freshly armed reminder's alarm stage lands right
 * away. `startActivityForFocus` self-gates, so this is a no-op while dormant.
 */
export async function ensureActivityForFocus(focused: FocusedTrip): Promise<void> {
  const records = await listTripActivityRecords();
  const pending =
    focused.liveActivityId != null &&
    records.some((r) => r.id === focused.liveActivityId && r.state === "pending");
  // A scheduled activity hasn't started yet, so `updateActivity` can't reach it
  // — and ActivityKit can't move a pending activity's start date. Arming or
  // re-arming a reminder moves that date (the activity leads the leave alarm,
  // not departure), so end the pending one and schedule a fresh one. Unchanged
  // start instant → leave it alone rather than churn the OS slot.
  if (pending) {
    const wanted = focusedActivityStartAt(focused);
    if (wanted == null || wanted === focused.liveActivityScheduledFor) return;
    await endFocusActivity(focused);
    await startActivityForFocus({
      ...focused,
      liveActivityId: undefined,
      liveActivityScheduledFor: undefined,
    });
    return;
  }
  // Revive/start when nothing live covers the focus; otherwise push current
  // content so a just-armed reminder's alarm stage shows immediately.
  if (!(await startOrReviveActivity(focused, records))) {
    await refreshActivityContent(focused);
  }
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
  let focused = loadFocusedTrip();
  const records = await listTripActivityRecords();
  // Adopt a running activity for the SAME trip+service date when the focus's
  // committed `liveActivityId` hasn't landed yet — `startActivityForFocus`
  // commits it asynchronously, so a reconcile racing a just-started activity
  // (e.g. a foreground/focus event fired as the reminder dialog closes) would
  // otherwise end the fresh activity as an "orphan", blanking the lock screen /
  // Dynamic Island. Commit the recovered id so the rest of this pass — and
  // later updates/reconciles — target it instead of ending/restarting it.
  if (
    focused != null &&
    (focused.liveActivityId == null ||
      !records.some((r) => r.id === focused!.liveActivityId))
  ) {
    const prefix = `trip-${focused.tripNumber}-${focused.serviceDate}-`;
    const adopted = records.find((r) => r.id.startsWith(prefix));
    if (adopted) {
      focused = { ...focused, liveActivityId: adopted.id };
      saveFocusedTrip(focused);
      notifyChange();
    }
  }
  // The OS started a scheduled activity while we weren't running: it's live now,
  // so drop the pinned start instant. Otherwise `ensureActivityForFocus` keeps
  // comparing against a spent instant, and every re-registration would still
  // tell the backend to sleep until it.
  if (
    focused?.liveActivityScheduledFor != null &&
    records.some((r) => r.id === focused!.liveActivityId && r.state !== "pending")
  ) {
    const running: FocusedTrip = { ...focused };
    delete running.liveActivityScheduledFor;
    focused = running;
    saveFocusedTrip(focused);
    notifyChange();
  }
  const keep = focused?.liveActivityId;
  await Promise.all(
    records.filter((r) => r.id !== keep).map((r) => endTripActivity(r.id)),
  );
  // (Re)start or revive the focus's activity if nothing live is on screen for
  // it (never started, frozen by the background auto-dismiss, system-purged).
  // Returns false when a live / user-dismissed / push-ended activity already
  // covers it, in which case we fall through to the push self-heal below.
  if (focused && (await startOrReviveActivity(focused, records))) return;
  // Push heal: the running activity's registration POST may have failed at
  // focus time (offline), silently degrading locked-screen corrections.
  // Re-registering is an idempotent upsert keyed on the activity id (and
  // refreshes the server-side TTLs), so re-POST on every boot.
  if (focused && keep && isLiveActivityPushEnabled()) {
    const registration = buildRegistrationForFocus(focused, keep);
    if (registration) await postRegistrationDeduped(registration);
  }
}

/**
 * Schedule `reminder` on the best available channel and, on success, persist it
 * onto the focused trip and notify consumers. Shared by the arm + drift-
 * reschedule paths.
 *
 * Prefers a true "Leave Alarm" on iOS (AlarmKit) and Android (setAlarmClock) —
 * it breaks through Silent Mode / Focus / DND — falling back to a local
 * notification otherwise (web, alarm unavailable/denied/off-day, or a create
 * failure). The alarm REPLACES the notification — never both, so the user gets
 * a single alert.
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
export async function armAndPersistReminder(
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
  const saved: FocusedTrip = { ...latest, reminder: { ...reminder, alarmId } };
  saveFocusedTrip(saved);
  notifyChange();
  // Tell the push backend about the (re)armed lead so its locked-screen pushes
  // keep showing the leave-alarm countdown. Best-effort; never blocks the arm.
  await reRegisterPushForFocus(saved);
  return { ok: true };
}

/**
 * Push the focused trip's live departure/arrival/delay into its running Live
 * Activity (drift + phase flip), self-healing the push registration alongside.
 * Reads the current focus itself; no-op when no activity is running, and deduped
 * against the last sent content so the RT poll / clock tick can call it freely.
 * Extracted from the hook's `updateLiveActivity` so the dedup map stays private.
 */
export async function syncFocusedActivityContent(args: {
  departureAt: number;
  arrivalAt: number;
  delayMinutes: number | null;
  nextStop?: string | null;
  remainingStops?: number | null;
  isCanceled?: boolean;
}): Promise<void> {
  const current = loadFocusedTrip();
  const id = current?.liveActivityId;
  if (!id) return;
  const timelineStart = current.liveActivityTimelineStart ?? Date.now();
  if (current.liveActivityTimelineStart == null) {
    saveFocusedTrip({ ...current, liveActivityTimelineStart: timelineStart });
  }
  // Self-heal the push registration alongside the content sync: this fires
  // exactly when a leave-in is at risk (delay/phase/reminder change, and the
  // first time the activity id commits), so re-asserting the armed reminder's
  // lead here closes the gap where the arm-time POST was lost or raced the id.
  // Deduped, so unchanged registrations don't re-hit the backend.
  if (current && isLiveActivityPushEnabled()) {
    const registration = buildRegistrationForFocus(
      current,
      id,
      current.liveActivityScheduledFor,
      timelineStart,
    );
    if (registration) void postRegistrationDeduped(registration);
  }
  const content = buildContentState({
    departureEpochMs: args.departureAt,
    arrivalEpochMs: args.arrivalAt,
    delayMinutes: args.delayMinutes,
    nextStop: args.nextStop ?? null,
    remainingStops: args.remainingStops ?? null,
    isCanceled: args.isCanceled ?? false,
    isEnded: false,
    reminderSet: current?.reminder != null,
    reminderEpochMs: current?.reminder?.reminderAt ?? null,
    timelineStartEpochMs: timelineStart,
    now: Date.now(),
  });
  const json = JSON.stringify(content);
  if (lastSentActivityContent.get(id) === json) return;
  const { updated } = await updateTripActivity(id, content);
  if (updated) lastSentActivityContent.set(id, json);
}
