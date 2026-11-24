import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Calendar, ChevronLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useStationSelection } from "@/contexts/stationSelection";
import {
  focusedPlaces,
  reconstructFocusedTrip,
  sameFocusIdentity,
  type FocusedTrip,
} from "@/lib/focusedTrip";
import { isFerryLeg, placeStation } from "@/lib/places";
import { validStation } from "@/lib/stationUtils";
import { futureServiceDate } from "@/lib/scheduleUtils";
import { buildDepartureTimestamp, toLocalDateKey } from "@/lib/timeUtils";
import { useLeaveTripView } from "@/hooks/useTripViewNavigation";
import { useMinuteClock } from "@/hooks/useMinuteClock";
import type { MyTripState } from "@/hooks/useMyTrip";
import { SectionCard } from "@/components/ui/section-card";
import {
  AlarmStatusIcon,
  AlarmStatusLabel,
} from "@/components/AlarmStatusLabel";
import { FerryLeg } from "@/components/FerryLeg";
import { DepartureReminder } from "@/components/DepartureReminder";
import { ReminderControl } from "@/components/ReminderControl";
import { LiveTimePair } from "@/components/LiveTimePair";
import { MyTripGate } from "@/components/MyTripGate";
import { QuickConnectionWarning } from "@/components/QuickConnectionWarning";
import { ShareTripButton } from "@/components/ShareTripButton";
import { StopTimeline } from "@/components/StopTimeline";
import { TripPositionCard } from "@/components/TripPositionCard";

const TIME_FORMAT = "12h" as const;

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
 * schedule, which keeps an in-progress bar linking here. "Stop tracking" turns
 * it back to green; it leaves on its own when nothing is left to show (the
 * auto-clear shortly after arrival).
 */
export default function MyTrip() {
  const { focusedTrip, setPreviewTrip } = useStationSelection();
  const leaveTripView = useLeaveTripView();
  const currentTime = useMinuteClock();
  const previewRun = usePreviewRun(currentTime);
  const isPreview =
    previewRun != null && !sameFocusIdentity(focusedTrip, previewRun);
  const shown = isPreview ? previewRun : focusedTrip;

  useEffect(() => () => setPreviewTrip(null), [setPreviewTrip]);

  // Open at the top — an in-app navigation otherwise keeps the scroll offset
  // of the page we came from (e.g. a trip card far down the schedule).
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const leftRef = useRef(false);
  useEffect(() => {
    if (shown || leftRef.current) return;
    leftRef.current = true;
    leaveTripView();
  }, [shown, leaveTripView]);

  if (!shown) return null;
  return (
    <MyTripGate
      focusedTrip={shown}
      currentTime={currentTime}
      isPreview={isPreview}
    >
      {(state) => <MyTripView state={state} onBack={leaveTripView} />}
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
    const trip = reconstructFocusedTrip({ ...run, serviceDate: "" });
    if (!trip) return null;
    const serviceDate =
      futureServiceDate(currentTime, scheduleType) ??
      toLocalDateKey(
        new Date(buildDepartureTimestamp(currentTime, trip.departureTime))
      );
    return { source: "user", ...run, serviceDate, reminder: null };
  }, [previewTrip, currentTime]);
}

function MyTripView({
  state,
  onBack,
}: {
  state: MyTripState;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const {
    clearFocusedTrip,
    setPreviewTrip,
    fromStation: homeFrom,
    toStation: homeTo,
  } = useStationSelection();

  const stopTracking = () => {
    const { from, to } = focusedPlaces(focusedTrip);
    setPreviewTrip({
      tripNumber: focusedTrip.tripNumber,
      from,
      to,
      scheduleType: focusedTrip.scheduleType,
    });
    void clearFocusedTrip();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const {
    focusedTrip,
    isPreview,
    trip,
    live,
    isFutureService,
    serviceDayLabel,
    clockTime,
    progress,
    model,
    accentBg,
    accentColor,
  } = state;
  const { fromStation, toStation } = focusedTrip;
  const places = focusedPlaces(focusedTrip);

  return (
    <div className="min-h-[100dvh] bg-background">
      {/* Nav row — sticks so "back" stays reachable down the stop list. */}
      <div
        className={cn(
          "sticky top-0 z-20 text-white transition-colors",
          accentBg
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
            {!isPreview && t("focusedTrip.myTrip")}
          </h1>
          <ShareTripButton
            trip={trip}
            serviceDate={focusedTrip.serviceDate}
            scheduleType={focusedTrip.scheduleType}
            timeFormat={TIME_FORMAT}
            className="bg-white/15 hover:bg-white/25"
          />
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
            <span className="whitespace-nowrap">{places.from}</span>
            <span className="font-normal text-white/60" aria-hidden="true">
              →
            </span>
            <span className="whitespace-nowrap">{places.to}</span>
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

          <div className="mt-3 empty:hidden">
            {isPreview ? (
              !progress.isEnded &&
              !model.isCanceledOrSkipped && (
                <DepartureReminder
                  tripNumber={trip.trip}
                  fromStation={fromStation}
                  toStation={toStation}
                  viaFerry={
                    trip.inboundFerry != null || trip.outboundFerry != null
                  }
                  departureTime={trip.departureTime}
                  liveDepartureTime={live?.liveDepartureTime ?? null}
                  arrivalTime={trip.arrivalTime}
                  realtimeArrivalTime={live?.liveArrivalTime ?? null}
                  liveStopDepartures={live?.allStopLiveDepartures}
                  currentTime={clockTime}
                  timeFormat={TIME_FORMAT}
                  scheduleType={focusedTrip.scheduleType}
                  isFocused={false}
                  sheetOpen
                  onClose={onBack}
                  variant="page"
                />
              )
            ) : (
              <ReminderControl
                focusedTrip={focusedTrip}
                trip={trip}
                live={live}
                minutesUntil={model.minutesUntil}
                isCanceledOrSkipped={model.isCanceledOrSkipped}
                isFutureService={isFutureService}
                currentTime={clockTime}
                timeFormat={TIME_FORMAT}
              />
            )}
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
            accentColor={accentColor}
            isPreview={isPreview}
            timeFormat={TIME_FORMAT}
          />
        )}

        {trip.inboundFerry && (
          <SectionCard className="p-4 md:p-5">
            {model.hasQuickConnection && !model.isCanceledOrSkipped && (
              <QuickConnectionWarning trainOption={model.trainOption} />
            )}
            <FerryLeg
              ferry={trip.inboundFerry}
              trainTime={model.departureTime}
              scheduleType={focusedTrip.scheduleType}
              timeFormat={TIME_FORMAT}
              inbound
            />
          </SectionCard>
        )}

        {/* Every stop on the leg, with the train's current stop highlighted. */}
        <SectionCard className="p-4 md:p-5">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("myTrip.stops")}
            </h2>
            <p className="truncate text-sm font-medium text-muted-foreground">
              {[
                model.stopsLabel,
                model.tripDurationLabel,
                model.fareInfo &&
                  (model.fareInfo.price > 0
                    ? `$${model.fareInfo.price.toFixed(2)}`
                    : t("common.free")),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <StopTimeline
            trip={trip}
            fromStation={fromStation}
            toStation={toStation}
            realtimeStatus={live}
            timeFormat={TIME_FORMAT}
            isEnded={progress.isEnded}
            atDestination={model.isAtDestination}
            stopInference={progress.stopInference}
            userFromStation={isPreview ? validStation(homeFrom) : null}
            userToStation={isPreview ? validStation(homeTo) : null}
            isFocused={!isPreview}
          />
        </SectionCard>

        {trip.outboundFerry && (
          <SectionCard className="p-4 md:p-5">
            {model.hasQuickConnection && !model.isCanceledOrSkipped && (
              <QuickConnectionWarning trainOption={model.trainOption} />
            )}
            <FerryLeg
              ferry={trip.outboundFerry}
              trainTime={model.arrivalTime}
              scheduleType={focusedTrip.scheduleType}
              timeFormat={TIME_FORMAT}
            />
          </SectionCard>
        )}

        {!isPreview && (
          <button
            type="button"
            onClick={stopTracking}
            className="h-12 w-full rounded-xl border border-border bg-card text-sm font-semibold text-destructive transition-colors hover:bg-destructive/5"
          >
            {t("myTrip.stopTracking")}
          </button>
        )}

        <div className="h-4" aria-hidden="true" />
      </main>
    </div>
  );
}
