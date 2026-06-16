import { useEffect, useMemo, useRef } from "react";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { useStationSelection } from "@/contexts/stationSelection";
import {
  anchorLiveTime,
  focusedArrivalInstant,
  focusedDepartureInstant,
  loadFocusedTrip,
  reconstructFocusedTrip,
  type FocusedTrip,
} from "@/lib/focusedTrip";
import { scheduleFocusActivityDismissal } from "@/hooks/useFocusedTrip";
import { useTripRealtimeStatusMap } from "@/hooks/useTripUpdates";
import { useNow } from "@/hooks/useNow";
import { buildContentState, derivePhase } from "@/lib/native/liveActivity";
import { logger } from "@/lib/logger";

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
  const { updateLiveActivity } = useStationSelection();
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

  // `phase` is a dep so crossing departure pushes exactly one update that
  // flips the headline countdown; the hook dedupes unchanged content, so the
  // re-fires from the 30s tick / RT poll are free. `liveActivityId` is a dep
  // so the first sync fires as soon as the (async) start commits the id.
  useEffect(() => {
    if (!liveActivityId || departureAt == null || arrivalAt == null) return;
    void updateLiveActivity({ departureAt, arrivalAt, delayMinutes, isCanceled });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveActivityId, departureAt, arrivalAt, delayMinutes, isCanceled, phase, reminderSet]);

  // Snapshot of what to hand iOS when the app backgrounds, kept in a ref so the
  // long-lived `appStateChange` listener always sees the latest live values
  // without re-subscribing. Null until we have both instants.
  const dismissSnapshotRef = useRef<{
    content: ReturnType<typeof buildContentState>;
    arrivalAt: number;
  } | null>(null);
  dismissSnapshotRef.current =
    liveActivityId && departureAt != null && arrivalAt != null
      ? {
          arrivalAt,
          content: buildContentState({
            departureEpochMs: departureAt,
            arrivalEpochMs: arrivalAt,
            delayMinutes,
            nextStop: null,
            remainingStops: null,
            isCanceled,
            isEnded: false,
            reminderSet,
            now,
          }),
        }
      : null;

  // When the app leaves the foreground, schedule the activity to auto-dismiss at
  // arrival (local path) so the Dynamic Island / lock screen clears itself even
  // if the JS never wakes again — the gap that left it lingering past arrival.
  // Registered once; the snapshot ref carries the live values.
  useEffect(() => {
    let handle: PluginListenerHandle | null = null;
    let cancelled = false;
    CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) return;
      const snap = dismissSnapshotRef.current;
      // Re-read storage rather than trust a stale closure: the focus may have
      // been cleared/replaced since this listener was registered.
      const current = loadFocusedTrip();
      if (!snap || !current) return;
      void scheduleFocusActivityDismissal(current, snap.content, snap.arrivalAt);
    })
      .then((listener) => {
        if (cancelled) listener.remove();
        else handle = listener;
      })
      .catch((error) => {
        logger.warn("Unable to register Live Activity background listener", error);
      });
    return () => {
      cancelled = true;
      handle?.remove();
    };
  }, []);

  return null;
}
