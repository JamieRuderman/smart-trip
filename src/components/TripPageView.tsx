import type { ReactNode } from "react";
import { Calendar, ChevronLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useStationSelection } from "@/contexts/stationSelection";
import { focusedPlaces } from "@/lib/focusedTrip";
import { validStation } from "@/lib/stationUtils";
import type { MyTripState } from "@/hooks/useMyTrip";
import { SectionCard } from "@/components/ui/section-card";
import { AlarmStatusIcon, AlarmStatusLabel } from "@/components/AlarmStatusLabel";
import { FerryLeg } from "@/components/FerryLeg";
import { DepartureReminder } from "@/components/DepartureReminder";
import { ReminderControl } from "@/components/ReminderControl";
import { LiveTimePair } from "@/components/LiveTimePair";
import { QuickConnectionWarning } from "@/components/QuickConnectionWarning";
import { ShareTripButton } from "@/components/ShareTripButton";
import { StopTimeline } from "@/components/StopTimeline";
import { TripPositionCard } from "@/components/TripPositionCard";

const TIME_FORMAT = "12h" as const;

/**
 * The trip page's view of one run, shared by My Trip, a train's green page and
 * a shared-trip link: the coloured band (train, live times, the leave → departs
 * → arrives headline and its action), where the train is, and every stop.
 */
export function TripPageView({
  state,
  onBack,
  actions,
  dateLine,
}: {
  state: MyTripState;
  onBack: () => void;
  /** Replaces the band's own action (Take this train / the reminder). */
  actions?: ReactNode;
  /** Shown under the stations, e.g. a shared trip's date. */
  dateLine?: string;
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
          {isPreview ? (
            <div className="min-w-0 flex-1" />
          ) : (
            <h1 className="min-w-0 flex-1 truncate text-sm font-semibold uppercase tracking-wider text-white/90">
              {t("focusedTrip.myTrip")}
            </h1>
          )}
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
          {dateLine && <p className="mt-0.5 text-xs text-white/80">{dateLine}</p>}

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
            {actions !== undefined ? (
              actions
            ) : isPreview ? (
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
