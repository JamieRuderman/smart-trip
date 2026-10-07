import { useLocation, useNavigate } from "react-router-dom";
import { Calendar, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useStationSelection } from "@/contexts/stationSelection";
import { useFocusedTripLive } from "@/hooks/useFocusedTripLive";
import { useMyTripState } from "@/hooks/useMyTrip";
import { TRIP_VIEW_PATH } from "@/lib/tripView";
import type { FocusedTrip } from "@/lib/focusedTrip";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import { AlarmStatusIcon, AlarmStatusLabel } from "./AlarmStatusLabel";

/**
 * Floating "trip in progress" bar on the schedule while a trip is focused — the
 * way back to the full-page My Trip view after stepping out of it. Shows the
 * same live headline as that view (leave / departs / arrives) in the same
 * my-trip colour. Renders nothing without a focused trip; the schedule reserves
 * room for it at the bottom of the page so it never covers the last content.
 */
export function ActiveTripBar({ currentTime }: { currentTime: Date }) {
  const { focusedTrip } = useStationSelection();
  if (!focusedTrip) return null;
  return (
    <ActiveTripBarLoaded
      key={`${focusedTrip.tripNumber}-${focusedTrip.serviceDate}-${focusedTrip.fromStation}-${focusedTrip.toStation}`}
      focusedTrip={focusedTrip}
      currentTime={currentTime}
    />
  );
}

function ActiveTripBarLoaded({
  focusedTrip,
  currentTime,
}: {
  focusedTrip: FocusedTrip;
  currentTime: Date;
}) {
  const { trip, live, lastUpdated } = useFocusedTripLive(
    focusedTrip,
    currentTime.getTime(),
  );
  if (!trip) return null;
  return (
    <ActiveTripBarContent
      focusedTrip={focusedTrip}
      trip={trip}
      live={live}
      lastUpdated={lastUpdated}
      currentTime={currentTime}
    />
  );
}

function ActiveTripBarContent({
  focusedTrip,
  trip,
  live,
  lastUpdated,
  currentTime,
}: {
  focusedTrip: FocusedTrip;
  trip: ProcessedTrip;
  live: TripRealtimeStatus | null;
  lastUpdated: Date | null;
  currentTime: Date;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { isFutureService, serviceDayLabel, model, accentBg } = useMyTripState(
    { focusedTrip, trip, live, lastUpdated, currentTime },
  );

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3"
      style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
    >
      <button
        type="button"
        onClick={() =>
          navigate({ pathname: TRIP_VIEW_PATH, search: location.search })
        }
        className={cn(
          "pointer-events-auto mx-auto flex w-full max-w-xl items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-white",
          "shadow-[0_4px_20px_rgba(0,0,0,0.3)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
          accentBg,
        )}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/20">
          {isFutureService ? (
            <Calendar className="h-5 w-5" aria-hidden="true" />
          ) : (
            <AlarmStatusIcon status={model.alarmStatus} className="h-5 w-5" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate leading-tight">
            {isFutureService ? (
              <span className="text-base font-semibold capitalize">
                {t("focusedTrip.departsOn", { day: serviceDayLabel })}
              </span>
            ) : (
              <AlarmStatusLabel
                status={model.alarmStatus}
                className="text-base tracking-normal text-white"
              />
            )}
          </span>
          <span className="mt-0.5 block truncate text-xs text-white/80">
            {t("focusedTrip.myTrip")}
            {" · "}
            {t("myTrip.trainNumber", { trip: trip.trip })}
            {" · "}
            {focusedTrip.fromStation} → {focusedTrip.toStation}
          </span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-white/80" aria-hidden="true" />
      </button>
    </div>
  );
}
