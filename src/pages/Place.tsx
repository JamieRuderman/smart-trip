import { useLayoutEffect, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronLeft, Flag, MapPin, Ship, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useStationSelection } from "@/contexts/stationSelection";
import { useMinuteClock } from "@/hooks/useMinuteClock";
import { useStationArrivals, type Arrival } from "@/hooks/useStationArrivals";
import { useGoBack, useOpenTrainPage } from "@/hooks/useTripViewNavigation";
import { FERRY_CONSTANTS } from "@/lib/fareConstants";
import { isFocusedTrainToday } from "@/lib/focusedTrip";
import { SAN_FRANCISCO, validPlace, type Place } from "@/lib/places";
import { isTrainDelayed } from "@/lib/realtimeConstants";
import {
  getTodayScheduleType,
  inboundFerryTrain,
  upcomingFerries,
} from "@/lib/scheduleUtils";
import { stationTrackColor, stationZoneMap } from "@/lib/stationUtils";
import { minutesOfDay, parseTimeToMinutes } from "@/lib/timeUtils";
import {
  cardTripState,
  myTripCardStyle,
  stateCardStyle,
  stateText,
} from "@/lib/tripTheme";
import { SectionCard } from "@/components/ui/section-card";
import { FerryScheduleLink } from "@/components/FerryLeg";
import { TimeDisplay, formatTime } from "@/components/TimeDisplay";
import { TrainBadge } from "@/components/TrainBadge";
import { TripRow } from "@/components/TripRow";
import type { Station } from "@/types/smartSchedule";

/**
 * A place on the line map, full screen: its zone (or the ferry), buttons to
 * pick it as a trip end, and every train (or ferry) still to come today.
 */
export default function PlacePage() {
  const { t } = useTranslation();
  const params = useParams();
  const place = validPlace((params.place ?? "") as Place);

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [place]);

  const goBack = useGoBack("/map-diagram");

  if (!place) {
    return (
      <PlaceFrame color="hsl(var(--smart-train-green))" onBack={goBack} eyebrow="" place={null}>
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t("stationInfo.noUpcoming")}
        </p>
      </PlaceFrame>
    );
  }

  return place === SAN_FRANCISCO ? (
    <PlaceFrame
      color={stationTrackColor(FERRY_CONSTANTS.FERRY_STATION)}
      onBack={goBack}
      eyebrow={t("stationInfo.ferryLabel")}
      place={place}
      heading={t("stationInfo.nextFerries")}
    >
      <FerryDepartures />
    </PlaceFrame>
  ) : (
    <PlaceFrame
      color={stationTrackColor(place)}
      onBack={goBack}
      eyebrow={t("stationInfo.zoneLabel", { zone: stationZoneMap[place] })}
      place={place}
      heading={t("stationInfo.nextArrivals")}
    >
      <StationArrivals station={place} />
    </PlaceFrame>
  );
}

function PlaceFrame({
  color,
  onBack,
  eyebrow,
  place,
  heading,
  children,
}: {
  color: string;
  onBack: () => void;
  eyebrow: string;
  place: Place | null;
  heading?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { fromPlace, toPlace, setFromStation, setToStation } = useStationSelection();

  return (
    <div className="min-h-[100dvh] bg-background">
      <div
        className="sticky top-0 z-20 text-white"
        style={{ backgroundColor: color, paddingTop: "calc(8px + var(--safe-area-top))" }}
      >
        <div className="mx-auto flex max-w-2xl items-center px-3 pb-2">
          <button
            type="button"
            onClick={onBack}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 transition-colors hover:bg-white/25"
            aria-label={t("myTrip.back")}
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {place && (
        <header className="text-white" style={{ backgroundColor: color }}>
          <div className="mx-auto max-w-2xl px-4 pt-1 pb-5">
            <p className="text-xs font-bold uppercase tracking-widest text-white/80">
              {eyebrow}
            </p>
            <h1 className="mt-0.5 text-2xl font-bold">{place}</h1>
            {fromPlace && toPlace && (
              <RouteSummary from={fromPlace} to={toPlace} here={place} />
            )}
          </div>
        </header>
      )}

      <main className="mx-auto max-w-2xl space-y-4 px-4 pt-4 pb-safe">
        {place && (
          <SectionCard className="flex gap-3 p-4">
            <FromToColumn
              role="from"
              isCurrent={fromPlace === place}
              onClick={() => setFromStation(fromPlace === place ? "" : place)}
            />
            <FromToColumn
              role="to"
              isCurrent={toPlace === place}
              onClick={() => setToStation(toPlace === place ? "" : place)}
            />
          </SectionCard>
        )}
        <SectionCard className="p-3 md:p-5">
          {heading && (
            <h2 className="mb-3 px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              {heading}
            </h2>
          )}
          {children}
        </SectionCard>
        <div className="h-4" aria-hidden="true" />
      </main>
    </div>
  );
}

/** The trip ends under the place's name, with this place shown as "Here". */
function RouteSummary({ from, to, here }: { from: Place; to: Place; here: Place }) {
  const { t } = useTranslation();
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-sm font-medium text-white/90">
      <span className="whitespace-nowrap">{from === here ? t("stationInfo.here") : from}</span>
      <span className="font-normal text-white/60">→</span>
      <span className="whitespace-nowrap">{to === here ? t("stationInfo.here") : to}</span>
    </p>
  );
}

function FromToColumn({
  role,
  isCurrent,
  onClick,
}: {
  role: "from" | "to";
  isCurrent: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const RoleIcon = role === "from" ? MapPin : Flag;
  const ariaLabel = t(
    isCurrent
      ? role === "from"
        ? "stationInfo.clearDepartureAria"
        : "stationInfo.clearDestinationAria"
      : role === "from"
        ? "stationInfo.setAsDepartureAria"
        : "stationInfo.setAsDestinationAria",
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
        {t(role === "from" ? "stationInfo.departure" : "stationInfo.destination")}
      </span>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={isCurrent}
        aria-label={ariaLabel}
        className={cn(
          "flex h-11 items-center gap-2 rounded-xl px-3 text-left transition-colors",
          isCurrent
            ? "bg-primary/10 text-primary hover:bg-primary/20"
            : "bg-background text-foreground hover:bg-muted",
        )}
      >
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
            isCurrent ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
          aria-hidden="true"
        >
          {isCurrent ? <X className="h-3.5 w-3.5" /> : <RoleIcon className="h-3.5 w-3.5" />}
        </span>
        <span className="text-sm font-semibold leading-tight">
          {t(isCurrent ? "stationInfo.clearStation" : "stationInfo.setStation")}
        </span>
      </button>
    </div>
  );
}

function useEtaLabel() {
  const { t } = useTranslation();
  return (minutes: number) =>
    minutes <= 0
      ? t("stationInfo.nowArriving")
      : minutes >= 60
        ? t("stationInfo.inHoursMinutes", {
            hours: Math.floor(minutes / 60),
            minutes: minutes % 60,
          })
        : t("stationInfo.inMinutes", { minutes });
}

function StationArrivals({ station }: { station: Station }) {
  const { t } = useTranslation();
  const currentTime = useMinuteClock();
  const { fromPlace, toPlace, focusedTrip } = useStationSelection();
  const openTrainPage = useOpenTrainPage();
  const arrivals = useStationArrivals(
    station,
    currentTime,
    validPlace(fromPlace),
    validPlace(toPlace),
  );

  if (arrivals.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t("stationInfo.noUpcoming")}
      </p>
    );
  }
  return (
    <div role="list" className="space-y-2">
      {arrivals.map((a) => (
        <ArrivalRow
          key={`${a.tripNumber}-${a.isSouthbound}`}
          arrival={a}
          isFocused={isFocusedTrainToday(focusedTrip, a.tripNumber, a.isSouthbound, currentTime)}
          onClick={() =>
            openTrainPage({
              ...a.trip,
              // A leg from the terminus to itself has no trips, so the trip page can't open it.
              fromStation: station === a.terminus ? a.trip.fromStation : station,
              toStation: a.terminus,
            })
          }
        />
      ))}
    </div>
  );
}

function ArrivalRow({
  arrival,
  isFocused,
  onClick,
}: {
  arrival: Arrival;
  isFocused: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const etaLabel = useEtaLabel();
  const isSkipped = arrival.skipsStation || arrival.skipsDestination;
  const isDelayed = !isSkipped && isTrainDelayed(arrival);
  const cardState = cardTripState({
    isCanceledOrSkipped: arrival.isCanceled,
    isDelayed,
    isNextTrip: false,
    // Grey like a departed train, not red: it still runs, just not for this row's journey.
    isPastTrip: isSkipped,
  });
  const DirArrow = arrival.isSouthbound ? ArrowDown : ArrowUp;
  const etaCopy = arrival.isCanceled
    ? t("tripCard.canceled")
    : isSkipped
      ? t("tripCard.stopSkipped")
      : etaLabel(arrival.etaMinutes);

  return (
    <TripRow
      tone={isFocused ? myTripCardStyle : stateCardStyle[cardState]}
      onClick={onClick}
      ariaLabel={t("stationInfo.openTripAria", {
        trip: arrival.tripNumber,
        terminus: arrival.terminus,
      })}
    >
      <TrainBadge
        tripNumber={arrival.tripNumber}
        isPastTrip={isSkipped}
        isCanceled={arrival.isCanceled}
        isDelayed={isDelayed}
      />
      <div className="ml-1 min-w-0 flex-1 leading-tight">
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <DirArrow className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate font-medium">
            {t(arrival.isSouthbound ? "tracker.southbound" : "tracker.northbound")}
          </span>
        </div>
        <div
          className={cn(
            "mt-0.5 pl-5 text-xs tabular-nums",
            arrival.isCanceled ? "font-medium text-destructive" : "text-muted-foreground",
            isDelayed && "font-medium text-smart-gold",
          )}
        >
          {etaCopy}
        </div>
      </div>
      <div className="ml-2 shrink-0 text-right leading-tight">
        <div
          className={cn(
            "text-lg font-semibold tabular-nums",
            (arrival.isCanceled || arrival.skipsStation) && "line-through text-muted-foreground",
            isSkipped && stateText[cardState],
            isDelayed && "text-smart-gold",
          )}
        >
          <TimeDisplay time={arrival.effectiveTime} />
        </div>
        {arrival.destinationTime && (
          <div
            className={cn(
              "mt-0.5 text-xs tabular-nums text-muted-foreground",
              (arrival.isCanceled || arrival.skipsDestination) && "line-through",
            )}
          >
            {t("stationInfo.arrivingAt", { time: formatTime(arrival.destinationTime) })}
          </div>
        )}
        {isDelayed && (
          <TimeDisplay
            time={arrival.scheduledTime}
            className="text-xs line-through text-muted-foreground"
          />
        )}
      </div>
    </TripRow>
  );
}

function FerryDepartures() {
  const { t } = useTranslation();
  const currentTime = useMinuteClock();
  const { focusedTrip } = useStationSelection();
  const openTrainPage = useOpenTrainPage();
  const etaLabel = useEtaLabel();
  const nowMinutes = minutesOfDay(currentTime);
  const ferries = upcomingFerries(currentTime, true);
  const scheduleType = getTodayScheduleType(currentTime);

  return (
    <>
      {ferries.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t("stationInfo.noMoreFerries")}
        </p>
      ) : (
        <div role="list" className="space-y-2">
          {ferries.map((ferry) => {
            const train = inboundFerryTrain(ferry, scheduleType);
            const isFocused =
              train != null && isFocusedTrainToday(focusedTrip, train.trip, false, currentTime);
            return (
              <TripRow
                key={ferry.depart}
                tone={isFocused ? myTripCardStyle : stateCardStyle.future}
                onClick={train ? () => openTrainPage(train) : undefined}
                ariaLabel={
                  train
                    ? t("stationInfo.openTripAria", { trip: train.trip, terminus: train.toStation })
                    : undefined
                }
              >
                <Ship className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="ml-3 min-w-0 flex-1 leading-tight">
                  <div className="text-sm font-medium text-muted-foreground">
                    {ferry.sfGate ? t("ferry.gate", { gate: ferry.sfGate }) : t("ferry.sfTerminal")}
                  </div>
                  <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                    {etaLabel(parseTimeToMinutes(ferry.depart) - nowMinutes)}
                  </div>
                </div>
                <div className="ml-3 shrink-0 text-right leading-tight">
                  <div className="text-lg font-semibold tabular-nums">
                    <TimeDisplay time={ferry.depart} />
                  </div>
                  <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                    {t("stationInfo.arrivesLarkspur", { time: formatTime(ferry.arrive) })}
                  </div>
                </div>
              </TripRow>
            );
          })}
        </div>
      )}
      <FerryScheduleLink className="mt-4 text-xs text-muted-foreground" />
    </>
  );
}
