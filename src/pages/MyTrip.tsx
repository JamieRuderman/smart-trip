import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useStationSelection } from "@/contexts/stationSelection";
import {
  reconstructFocusedTrip,
  sameFocusIdentity,
  type FocusedTrip,
} from "@/lib/focusedTrip";
import { isFerryLeg, placeStation } from "@/lib/places";
import { futureServiceDate } from "@/lib/scheduleUtils";
import { toLocalDateKey } from "@/lib/timeUtils";
import { useLeaveTripView } from "@/hooks/useTripViewNavigation";
import { useMinuteClock } from "@/hooks/useMinuteClock";
import { MyTripGate } from "@/components/MyTripGate";
import { TripPageView } from "@/components/TripPageView";

/**
 * Full-page trip view. Tapping a schedule row opens it for that train in green,
 * with "Take this train"; taking it turns the same page into My Trip (blue).
 *
 * As My Trip it's the focused ("Take this train") trip — the riding screen. The
 * coloured band up top carries the train, its live times and the leave →
 * departs → arrives headline (plus the reminder control); below it, where the
 * train is right now and every stop on the leg.
 *
 * A launch with a trip running today opens here. Backing out returns to the
 * schedule, which keeps an in-progress bar linking here. "End trip" turns it
 * back to green; it leaves on its own when nothing is left to show (the
 * auto-clear shortly after arrival).
 */
export default function MyTrip() {
  const { focusedTrip, previewTrip } = useStationSelection();
  const location = useLocation();
  // Back/Forward onto a train's entry: the provider restores its train from
  // the URL in an effect that runs after this page's.
  const restoring =
    previewTrip == null && new URLSearchParams(location.search).has("trip");
  const leaveTripView = useLeaveTripView();
  const currentTime = useMinuteClock();
  const previewRun = usePreviewRun(currentTime);
  const isPreview =
    previewRun != null && !sameFocusIdentity(focusedTrip, previewRun);
  const shown = isPreview ? previewRun : focusedTrip;

  // Open at the top — an in-app navigation otherwise keeps the scroll offset
  // of the page we came from (e.g. a trip card far down the schedule).
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const leftRef = useRef(false);
  useEffect(() => {
    if (shown || restoring || leftRef.current) return;
    leftRef.current = true;
    leaveTripView();
  }, [shown, restoring, leaveTripView]);

  if (!shown || restoring) return null;
  return (
    <MyTripGate
      focusedTrip={shown}
      currentTime={currentTime}
      isPreview={isPreview}
    >
      {(state) => <TripPageView state={state} onBack={leaveTripView} />}
    </MyTripGate>
  );
}

/** The previewed train as an unsaved run, for the green page. */
function usePreviewRun(currentTime: Date): FocusedTrip | null {
  const { previewTrip } = useStationSelection();
  return useMemo(() => {
    if (!previewTrip) return null;
    const { tripNumber, from, to, scheduleType } = previewTrip;
    const run = {
      tripNumber,
      fromStation: placeStation(from),
      toStation: placeStation(to),
      ...(isFerryLeg(from, to) ? { viaFerry: true as const } : {}),
      scheduleType,
    };
    if (!reconstructFocusedTrip({ ...run, serviceDate: "" })) return null;
    // Today's schedule is today's runs, departed ones included, as in its list.
    const serviceDate =
      futureServiceDate(currentTime, scheduleType) ?? toLocalDateKey(currentTime);
    return { source: "user", ...run, serviceDate, reminder: null };
  }, [previewTrip, currentTime]);
}
