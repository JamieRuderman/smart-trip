import { useEffect, useMemo } from "react";
import { Capacitor } from "@capacitor/core";
import { useStationSelection } from "@/contexts/stationSelection";
import {
  anchorLiveTime,
  focusedArrivalInstant,
  focusedDepartureInstant,
  reconstructFocusedTrip,
  type FocusedTrip,
} from "@/lib/focusedTrip";
import { useTripRealtimeStatusMap } from "@/hooks/useTripUpdates";
import { useNow } from "@/hooks/useNow";
import { derivePhase } from "@/lib/native/liveActivity";

function dateKey(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Invisible app-level syncer that keeps the focused trip's iOS Live Activity
 * (lock screen + Dynamic Island) aligned with realtime: departure/arrival
 * drift, delay, cancellation, and the pre-departure → en-route phase flip.
 *
 * Lives at the app root — NOT inside a trip view — because the activity must
 * track the focused train wherever the user is (home screen, map routes,
 * detail sheet closed) and even when the trip's own controls have unmounted
 * (a cancelled trip hides the reminder section, but its activity still needs
 * the "Cancelled" update). Only mounts its polling half on iOS native with a
 * focus present, so web/Android never pay for the extra realtime traffic.
 */
export function LiveActivitySync() {
  const { focusedTrip } = useStationSelection();
  if (Capacitor.getPlatform() !== "ios" || !focusedTrip) return null;
  return <LiveActivitySyncInner focusedTrip={focusedTrip} />;
}

function LiveActivitySyncInner({ focusedTrip }: { focusedTrip: FocusedTrip }) {
  const { updateLiveActivity, clearFocusedTrip } = useStationSelection();
  // 30s tick: cheap re-render that re-evaluates the phase boundary between
  // realtime polls so the departure→arrival flip lands close to on time.
  const nowSeconds = useNow(30_000);
  const now = nowSeconds * 1000;

  const trip = useMemo(() => reconstructFocusedTrip(focusedTrip), [focusedTrip]);
  const trips = useMemo(() => (trip ? [trip] : []), [trip]);
  const { statusMap, canceledByStartTime } = useTripRealtimeStatusMap(
    focusedTrip.fromStation,
    focusedTrip.toStation,
    trips,
  );

  // Same primary + cancelled-fallback lookup as FocusedTripCard, so the lock
  // screen and the pinned card always tell the same story.
  const realtimeStatus = useMemo(() => {
    if (!trip) return null;
    const primary = statusMap.get(trip.departureTime);
    if (primary) return primary;
    if (canceledByStartTime.size > 0) {
      for (const time of trip.times) {
        const secondary = canceledByStartTime.get(time);
        if (secondary) return secondary;
      }
    }
    return null;
  }, [statusMap, canceledByStartTime, trip]);

  // The RT feed describes TODAY's runs only — a future-service focus (e.g. a
  // weekend trip picked on a weekday) must not inherit live data from a
  // same-numbered trip running today.
  const live =
    focusedTrip.serviceDate === dateKey(new Date(now)) ? realtimeStatus : null;

  // Anchor onto the focused trip's own service date (overnight-safe) rather
  // than "today", so these are correct on any route/view and any clock day.
  const staticDepartureAt = useMemo(
    () => focusedDepartureInstant(focusedTrip),
    [focusedTrip],
  );
  const staticArrivalAt = useMemo(
    () => focusedArrivalInstant(focusedTrip),
    [focusedTrip],
  );
  const departureAt =
    staticDepartureAt != null && live?.liveDepartureTime
      ? anchorLiveTime(staticDepartureAt, live.liveDepartureTime)
      : staticDepartureAt;
  const arrivalAt =
    staticArrivalAt != null && live?.liveArrivalTime
      ? anchorLiveTime(staticArrivalAt, live.liveArrivalTime)
      : staticArrivalAt;
  const delayMinutes = live?.delayMinutes ?? null;
  // A skipped boarding stop is a cancellation as far as this user's leg is
  // concerned — mirror useTripStatus's isCanceledOrSkipped.
  const isCanceled = (live?.isCanceled ?? false) || (live?.isOriginSkipped ?? false);

  const phase =
    departureAt != null ? derivePhase({ departureEpochMs: departureAt, now }) : null;
  const liveActivityId = focusedTrip.liveActivityId ?? null;
  // Re-push content (which carries reminderSet) when a reminder is armed/cleared
  // so the bell icon appears/disappears live.
  const reminderSet = focusedTrip.reminder != null;
  // Cross the alarm fire instant the same way we cross departure: a dep flip
  // that pushes one update so the compact island / lock screen swap the bell +
  // "Alarm in" countdown for the train + "Departs in" countdown on time.
  const reminderAt = focusedTrip.reminder?.reminderAt ?? null;
  const alarmPending = reminderAt != null && now < reminderAt;

  // `phase` / `alarmPending` are deps so crossing the alarm fire time and then
  // departure each push exactly one update that flips the leading countdown;
  // the hook dedupes unchanged content, so the re-fires from the 30s tick / RT
  // poll are free. `liveActivityId` is a dep so the first sync fires as soon as
  // the (async) start commits the id.
  useEffect(() => {
    if (!liveActivityId || departureAt == null || arrivalAt == null) return;
    void updateLiveActivity({ departureAt, arrivalAt, delayMinutes, isCanceled });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveActivityId, departureAt, arrivalAt, delayMinutes, isCanceled, phase, reminderSet, alarmPending]);

  // Once arrival passes while the app is foreground, end the activity and clear
  // the focus right away (the 30s tick is what crosses the boundary) — rather
  // than leaving it in the Dynamic Island showing the clock-derived "Arrived"
  // state until the next foreground reconcile. This closes the app-open-at-
  // arrival gap; the backgrounded-through-arrival case can't be ended locally
  // (ActivityKit can't schedule a future dismissal without ending — and so
  // removing from the island — immediately), where iOS's expiry is the backstop.
  // clearFocusedTrip is idempotent, and clearing the focus unmounts this syncer,
  // so it can't re-fire.
  useEffect(() => {
    if (arrivalAt == null || now < arrivalAt) return;
    void clearFocusedTrip();
  }, [now, arrivalAt, clearFocusedTrip]);

  // NOTE: we deliberately do NOT end the activity when the app goes inactive.
  // An ended Live Activity drops out of the Dynamic Island (it only lingers on
  // the lock screen until its dismissal date), and iOS fires `isActive:false`
  // for transient interruptions too (permission prompts, Control Center, the
  // app switcher) — so ending here blanked the island the user is waiting on
  // and churned start/end on every interruption. Post-arrival cleanup is
  // handled by the foreground reconcile + the focus's 30s arrival tick (and
  // iOS's own Live Activity expiry as a backstop), all while the activity stays
  // live and visible in the Dynamic Island.

  return null;
}
