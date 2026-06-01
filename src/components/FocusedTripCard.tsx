import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigation } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStationSelection } from "@/contexts/stationSelection";
import { reconstructFocusedTrip, type FocusedTrip } from "@/lib/focusedTrip";
import { useTripRealtimeStatusMap } from "@/hooks/useTripUpdates";
import { SHEET_TRANSITION_MS } from "@/lib/animationConstants";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import { TripCard } from "./TripCard";

interface FocusedTripCardProps {
  currentTime: Date;
  timeFormat: "12h" | "24h";
}

/**
 * Pinned representation of the user's focused trip ("Go"), shown above the
 * schedule. Always rendered the same way regardless of the home screen's
 * current from/to — reconstructed from static schedule, with live realtime
 * status overlaid. Returns null when nothing is focused or the trip can no
 * longer be found in the schedule.
 *
 * When the focus is cleared (Stop) while this card's detail sheet is open, the
 * card stays mounted for one transition so the sheet animates closed instead
 * of vanishing instantly.
 */
export function FocusedTripCard({ currentTime, timeFormat }: FocusedTripCardProps) {
  const { focusedTrip } = useStationSelection();

  const [detailOpen, setDetailOpenState] = useState(false);
  const detailOpenRef = useRef(false);
  const setDetailOpen = useCallback((open: boolean) => {
    detailOpenRef.current = open;
    setDetailOpenState(open);
  }, []);

  const [closing, setClosing] = useState(false);
  const lastFocusedRef = useRef<FocusedTrip | null>(focusedTrip);

  useEffect(() => {
    if (focusedTrip) {
      lastFocusedRef.current = focusedTrip;
      setClosing(false);
      return;
    }
    // Focus just cleared. If a detail sheet is open, keep the card mounted and
    // animate the sheet closed before dropping; otherwise unmount immediately.
    if (!detailOpenRef.current) return;
    setDetailOpen(false);
    setClosing(true);
    const id = window.setTimeout(() => setClosing(false), SHEET_TRANSITION_MS);
    return () => window.clearTimeout(id);
  }, [focusedTrip, setDetailOpen]);

  const effective = focusedTrip ?? (closing ? lastFocusedRef.current : null);
  const trip = useMemo(
    () => (effective ? reconstructFocusedTrip(effective) : null),
    [effective],
  );

  if (!effective || !trip) return null;
  return (
    <FocusedTripCardInner
      focusedTrip={effective}
      trip={trip}
      currentTime={currentTime}
      timeFormat={timeFormat}
      detailOpen={detailOpen}
      setDetailOpen={setDetailOpen}
    />
  );
}

function FocusedTripCardInner({
  focusedTrip,
  trip,
  currentTime,
  timeFormat,
  detailOpen,
  setDetailOpen,
}: {
  focusedTrip: FocusedTrip;
  trip: ProcessedTrip;
  currentTime: Date;
  timeFormat: "12h" | "24h";
  detailOpen: boolean;
  setDetailOpen: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const trips = useMemo(() => [trip], [trip]);
  const { statusMap, canceledByStartTime, lastUpdated } = useTripRealtimeStatusMap(
    focusedTrip.fromStation,
    focusedTrip.toStation,
    trips,
  );

  const realtimeStatus = useMemo(() => {
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

  return (
    <section aria-label={t("focusedTrip.pinnedLabel")} className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-primary uppercase tracking-wide">
        <Navigation className="h-3.5 w-3.5" aria-hidden="true" />
        {t("focusedTrip.going")}
      </div>
      <TripCard
        trip={trip}
        isNextTrip={false}
        isPastTrip={false}
        isFocused
        showFerry={false}
        timeFormat={timeFormat}
        realtimeStatus={realtimeStatus}
        lastUpdated={lastUpdated}
        fromStation={focusedTrip.fromStation}
        toStation={focusedTrip.toStation}
        currentTime={currentTime}
        selectedTripNumber={detailOpen ? trip.trip : null}
        onSelectTrip={(n) => setDetailOpen(n === trip.trip)}
      />
    </section>
  );
}
