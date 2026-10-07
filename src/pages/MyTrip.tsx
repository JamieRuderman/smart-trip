import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { Calendar, ChevronLeft, Clock, MapPin, Ticket } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useStationSelection } from "@/contexts/stationSelection";
import { useLeaveTripView } from "@/hooks/useTripViewNavigation";
import { useMinuteClock } from "@/hooks/useMinuteClock";
import type { MyTripState } from "@/hooks/useMyTrip";
import { SectionCard } from "@/components/ui/section-card";
import {
  AlarmStatusIcon,
  AlarmStatusLabel,
} from "@/components/AlarmStatusLabel";
import { FerryConnection } from "@/components/FerryConnection";
import { FocusedTripReminderRow } from "@/components/FocusedTripReminderRow";
import { LiveTimePair } from "@/components/LiveTimePair";
import { MyTripGate } from "@/components/MyTripGate";
import { QuickConnectionWarning } from "@/components/QuickConnectionWarning";
import { StopTimeline } from "@/components/StopTimeline";
import { TripPositionCard } from "@/components/TripPositionCard";

const TIME_FORMAT = "12h" as const;

/**
 * Full-page "My Trip" view of the focused ("Take this train") trip — the
 * riding screen. The coloured band up top carries the train, its live times and
 * the leave → departs → arrives headline (plus the reminder control); below it,
 * where the train is right now, the trip facts and every stop on the leg.
 *
 * It's where "Take this train" lands and what a launch with a trip running
 * today opens to. Backing out returns to the schedule, which keeps an
 * in-progress bar linking here. Leaves on its own once the focus is cleared
 * (Cancel, or the auto-clear shortly after arrival).
 */
export default function MyTrip() {
  const { focusedTrip } = useStationSelection();
  const leaveTripView = useLeaveTripView();
  const currentTime = useMinuteClock();

  // Open at the top — an in-app navigation otherwise keeps the scroll offset
  // of the page we came from (e.g. a trip card far down the schedule).
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const leftRef = useRef(false);
  useEffect(() => {
    if (focusedTrip || leftRef.current) return;
    leftRef.current = true;
    leaveTripView();
  }, [focusedTrip, leaveTripView]);

  if (!focusedTrip) return null;
  return (
    <MyTripGate focusedTrip={focusedTrip} currentTime={currentTime}>
      {(state) => <MyTripView state={state} onBack={leaveTripView} />}
    </MyTripGate>
  );
}

function MyTripView({
  state,
  onBack,
}: {
  state: MyTripState;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const { clearFocusedTrip } = useStationSelection();
  const {
    focusedTrip,
    trip,
    live,
    isFutureService,
    serviceDayLabel,
    clockTime,
    showFerry,
    progress,
    model,
    accentBg,
  } = state;
  const { fromStation, toStation } = focusedTrip;

  return (
    <div className="min-h-[100dvh] bg-background">
      {/* Nav row — sticks so "back" stays reachable down the stop list. */}
      <div
        className={cn(
          "sticky top-0 z-20 text-white transition-colors",
          accentBg,
        )}
        style={{ paddingTop: "calc(8px + var(--safe-area-top))" }}
      >
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-3 pb-2">
          <button
            type="button"
            onClick={onBack}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 transition-colors hover:bg-white/25"
            aria-label={t("myTrip.back")}
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold uppercase tracking-wider text-white/90">
            {t("focusedTrip.myTrip")}
          </h1>
        </div>
      </div>

      {/* Hero band — same colour as the nav row, so the two read as one. */}
      <header
        className={cn("text-white transition-colors", accentBg)}
        aria-label={t("tracker.tripDetailsAria", { trip: trip.trip })}
      >
        <div className="mx-auto max-w-2xl px-4 pt-2 pb-5">
          {/* Each station name is an unbreakable unit so a long name wraps
              as a whole rather than mid-name. */}
          <p className="flex flex-wrap items-center gap-x-1.5 text-base font-semibold leading-snug">
            <span className="whitespace-nowrap">{fromStation}</span>
            <span className="font-normal text-white/60" aria-hidden="true">
              →
            </span>
            <span className="whitespace-nowrap">{toStation}</span>
          </p>

          <div className="mt-4 flex items-end gap-4">
            <div className="flex shrink-0 flex-col leading-none">
              <span className="mb-1 text-[0.65rem] font-medium uppercase tracking-wide text-white/70">
                {t("tracker.tripLabel")}
              </span>
              <span className="text-5xl font-bold leading-none tabular-nums">
                {trip.trip}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <LiveTimePair
                trip={trip}
                realtimeStatus={live}
                canceled={model.isCanceledOrSkipped}
                format={TIME_FORMAT}
              />
              <p className="mt-1 truncate text-xs font-medium text-white/80">
                {model.headerStatusLabel}
                <span className="text-white/50"> · </span>
                {model.directionLabel}
              </p>
            </div>
          </div>

          {/* The headline: leave → departs → arrives (or the service day for a
              run on a later day). */}
          <div className="mt-5 flex min-h-12 items-center gap-2.5 rounded-xl bg-white/15 px-3.5 py-2">
            {isFutureService ? (
              <>
                <Calendar
                  className="h-5 w-5 shrink-0 text-white/90"
                  aria-hidden="true"
                />
                <span className="text-lg font-semibold capitalize tracking-tight">
                  {t("focusedTrip.departsOn", { day: serviceDayLabel })}
                </span>
              </>
            ) : (
              <>
                <AlarmStatusIcon
                  status={model.alarmStatus}
                  className="h-5 w-5 shrink-0 text-white/90"
                />
                <AlarmStatusLabel
                  status={model.alarmStatus}
                  className="text-lg tracking-tight text-white"
                />
              </>
            )}
          </div>

          {/* Reminder control — renders nothing when none applies. */}
          <div className="mt-2 empty:hidden">
            <FocusedTripReminderRow
              focusedTrip={focusedTrip}
              minutesUntil={model.minutesUntil}
              isCanceledOrSkipped={model.isCanceledOrSkipped}
              isFutureService={isFutureService}
              timeFormat={TIME_FORMAT}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 pt-4 pb-safe">
        {/* Where the train is — only meaningful for today's, running trip. */}
        {!isFutureService && !model.isCanceledOrSkipped && (
          <TripPositionCard
            trip={trip}
            fromStation={fromStation}
            toStation={toStation}
            realtimeStatus={live}
            clockTime={clockTime}
            progress={progress}
            model={model}
            accentBg={accentBg}
            timeFormat={TIME_FORMAT}
          />
        )}

        {/* Trip facts */}
        <SectionCard
          className={cn(
            "grid divide-x divide-border p-0",
            model.fareInfo ? "grid-cols-3" : "grid-cols-2",
          )}
        >
          <TripFact
            icon={<Clock className="h-4 w-4" aria-hidden="true" />}
            label={t("myTrip.duration")}
            value={model.tripDurationLabel}
          />
          <TripFact
            icon={<MapPin className="h-4 w-4" aria-hidden="true" />}
            label={t("myTrip.stops")}
            value={model.stopsLabel}
          />
          {model.fareInfo && (
            <TripFact
              icon={<Ticket className="h-4 w-4" aria-hidden="true" />}
              label={t("myTrip.fare")}
              value={
                model.fareInfo.price > 0
                  ? `$${model.fareInfo.price.toFixed(2)}`
                  : t("common.free")
              }
            />
          )}
        </SectionCard>

        {/* Every stop on the leg, with the train's current stop highlighted. */}
        <SectionCard className="p-4 md:p-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("myTrip.stops")}
          </h2>
          <StopTimeline
            trip={trip}
            fromStation={fromStation}
            toStation={toStation}
            realtimeStatus={live}
            timeFormat={TIME_FORMAT}
            isEnded={progress.isEnded}
            atDestination={model.isAtDestination}
            stopInference={progress.stopInference}
            isFocused
          />
        </SectionCard>

        {((showFerry && trip.outboundFerry) || model.showInboundFerry) && (
          <SectionCard className="p-4 md:p-5">
            {model.hasQuickConnection && !model.isCanceledOrSkipped && (
              <QuickConnectionWarning trainOption={model.trainOption} />
            )}
            {showFerry && trip.outboundFerry && (
              <FerryConnection
                ferry={trip.outboundFerry}
                trainArrivalTime={model.arrivalTime}
                timeFormat={TIME_FORMAT}
                fullLeg
              />
            )}
            {model.showInboundFerry && trip.inboundFerry && (
              <FerryConnection
                ferry={trip.inboundFerry}
                trainDepartureTime={model.departureTime}
                timeFormat={TIME_FORMAT}
                inbound
                fullLeg
              />
            )}
          </SectionCard>
        )}

        <button
          type="button"
          onClick={() => void clearFocusedTrip()}
          className="h-12 w-full rounded-xl border border-border bg-card text-sm font-semibold text-destructive transition-colors hover:bg-destructive/5"
        >
          {t("myTrip.cancelTrip")}
        </button>

        <div className="h-4" aria-hidden="true" />
      </main>
    </div>
  );
}

function TripFact({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 px-3 py-3 text-center">
      <p className="flex items-center justify-center gap-1 text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-semibold">{value}</p>
    </div>
  );
}
