import { Calendar, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useStationSelection } from "@/contexts/stationSelection";
import { useOpenTripView } from "@/hooks/useTripViewNavigation";
import { AlarmStatusIcon, AlarmStatusLabel } from "./AlarmStatusLabel";
import { MyTripGate } from "./MyTripGate";

/**
 * Floating "trip in progress" bar on the schedule while a trip is focused — the
 * way back to the full-page My Trip view after stepping out of it. Shows the
 * same live headline as that view (leave / departs / arrives) in the same
 * my-trip colour. Render it at the end of the page's content: alongside the
 * fixed bar it leaves a spacer so the bar never covers the last content.
 * Renders nothing without a focused trip.
 */
export function ActiveTripBar({ currentTime }: { currentTime: Date }) {
  const { t } = useTranslation();
  const { focusedTrip } = useStationSelection();
  const openTripView = useOpenTripView();
  if (!focusedTrip) return null;

  return (
    <MyTripGate focusedTrip={focusedTrip} currentTime={currentTime}>
      {({ trip, isFutureService, serviceDayLabel, model, accentBg }) => (
        <>
          <div className="h-20 shrink-0" aria-hidden="true" />
          <div
            className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3"
            style={{
              paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))",
            }}
          >
            <button
              type="button"
              onClick={openTripView}
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
                  <AlarmStatusIcon
                    status={model.alarmStatus}
                    className="h-5 w-5"
                  />
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
              <ChevronRight
                className="h-5 w-5 shrink-0 text-white/80"
                aria-hidden="true"
              />
            </button>
          </div>
        </>
      )}
    </MyTripGate>
  );
}
