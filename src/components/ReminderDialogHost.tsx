import { useEffect, useMemo, useRef } from "react";
import { useStationSelection } from "@/contexts/stationSelection";
import {
  anchorLiveTime,
  focusedDepartureInstant,
  type FocusedTrip,
} from "@/lib/focusedTrip";
import { useFocusedTripLive } from "@/hooks/useFocusedTripLive";
import { useNow } from "@/hooks/useNow";
import { ReminderDialog } from "./ReminderDialog";

/**
 * App-level host for the departure-reminder modal. Lives at the root — NOT in a
 * trip view — so "Take this train" (or the home card's "Add reminder") can open
 * it from any surface, and it survives the triggering sheet unmounting and route
 * changes. Mirrors {@link LiveActivitySync}'s focused-trip + realtime derivation
 * so the lead-time math anchors to the live boarding departure on the trip's own
 * service date, on any route and clock day.
 */
export function ReminderDialogHost() {
  const { focusedTrip, reminderDialogOpen, closeReminderDialog } =
    useStationSelection();
  // Close the modal if the focus is *cleared* while it's still open (e.g. the
  // trip auto-cleared on arrival), so a stale flag can't resurface it on the
  // next focus. Tracks the previous focus so this fires only on a present→absent
  // transition — NOT during the brief async gap after "Take this train" opens
  // the modal a tick before the freshly-focused trip lands.
  const prevFocusedRef = useRef<FocusedTrip | null>(focusedTrip);
  useEffect(() => {
    const hadFocus = prevFocusedRef.current;
    prevFocusedRef.current = focusedTrip;
    if (hadFocus && !focusedTrip && reminderDialogOpen) closeReminderDialog();
  }, [focusedTrip, reminderDialogOpen, closeReminderDialog]);

  if (!focusedTrip) return null;
  return <ReminderDialogHostInner focusedTrip={focusedTrip} />;
}

function ReminderDialogHostInner({ focusedTrip }: { focusedTrip: FocusedTrip }) {
  const { reminderDialogOpen, closeReminderDialog } = useStationSelection();
  // Tick each second only while the modal is open so the selectable lead range
  // stays current as departure approaches; idle otherwise.
  const nowSeconds = useNow(1_000, reminderDialogOpen);
  const now = nowSeconds * 1000;
  const currentTime = useMemo(() => new Date(now), [now]);

  // Shared focused-trip realtime derivation (same lookup as the pinned card).
  const { live } = useFocusedTripLive(focusedTrip, now);

  // Live-anchored boarding departure on the focused trip's own service date.
  const staticDepartureAt = useMemo(
    () => focusedDepartureInstant(focusedTrip),
    [focusedTrip],
  );
  const departureAt =
    staticDepartureAt != null && live?.liveDepartureTime
      ? anchorLiveTime(staticDepartureAt, live.liveDepartureTime)
      : staticDepartureAt;

  if (departureAt == null) return null;

  return (
    <ReminderDialog
      open={reminderDialogOpen}
      onClose={closeReminderDialog}
      departureAt={departureAt}
      fromStation={focusedTrip.fromStation}
      tripNumber={focusedTrip.tripNumber}
      currentTime={currentTime}
      timeFormat="12h"
      currentLeadMinutes={focusedTrip.reminder?.leadMinutes ?? null}
    />
  );
}
