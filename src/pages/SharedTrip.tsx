import { useLayoutEffect, useMemo, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { TripDetailContent } from "@/components/TripDetailContent";
import { Button } from "@/components/ui/button";
import { useStationSelection } from "@/contexts/stationSelection";
import { useMinuteClock } from "@/hooks/useMinuteClock";
import { useScheduleData, useScheduleRefreshing } from "@/hooks/useScheduleData";
import { useTripProgress } from "@/hooks/useTripProgress";
import { useTripStatus } from "@/hooks/useTripStatus";
import { findRealtimeStatus, useTripRealtimeStatusMap } from "@/hooks/useTripUpdates";
import {
  focusedBoardingInstant,
  reconstructFocusedTrip,
  sameFocusIdentity,
} from "@/lib/focusedTrip";
import { isReminderSupported } from "@/lib/notificationScheduler";
import { reminderLeadRange } from "@/lib/reminderLead";
import { tripEnds, type ProcessedTrip } from "@/lib/scheduleUtils";
import {
  androidSharedTripIntent,
  formatSharedServiceDate,
  matchesSharedDeparture,
  parseSharedTrip,
  sharedTripArrival,
  sharedTripUrl,
  type SharedTrip as SharedTripData,
} from "@/lib/sharedTrip";
import { agencyClockHHMM, agencyDateKey, parseServiceDate } from "@/lib/timeUtils";
import { stateBg } from "@/lib/tripTheme";
import { hasInAppHistory, TRIP_VIEW_PATH } from "@/lib/tripView";

export default function SharedTrip() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  useScheduleData();
  const scheduleRefreshing = useScheduleRefreshing();
  const shared = parseSharedTrip(location.search);
  const trip = shared ? reconstructFocusedTrip(shared.run) : null;

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [location.search]);

  const goBack = () => {
    if (hasInAppHistory(location.key)) navigate(-1);
    else navigate("/", { replace: true });
  };

  return (
    <main className="flex min-h-[100dvh] flex-col bg-card"
      style={{ paddingBottom: "max(var(--safe-area-bottom), env(safe-area-inset-bottom, 0px))" }}>
      {shared && trip && matchesSharedDeparture(shared, trip) ? (
        <SharedItinerary key={location.search} shared={shared} trip={trip} onBack={goBack} />
      ) : (
        <div className="mx-auto w-full max-w-2xl space-y-4 px-4"
          style={{ paddingTop: "var(--safe-area-top)" }}>
          <header className="flex items-center gap-3">
            <Button variant="outline" size="icon" className="size-11 shrink-0 rounded-xl"
              aria-label={t("myTrip.back")} onClick={goBack}>
              <ArrowLeft className="size-5" aria-hidden="true" />
            </Button>
            <h1 className="text-xl font-semibold">{t("shareTrip.title")}</h1>
          </header>
          <p role="status">{t(shared && scheduleRefreshing ? "shareTrip.loading" : "shareTrip.unavailable")}</p>
        </div>
      )}
    </main>
  );
}

function SharedItinerary({ shared, trip, onBack }: {
  shared: SharedTripData;
  trip: ProcessedTrip;
  onBack: () => void;
}) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { focusedTrip, focusTrip, setSelectedTrip, openReminderDialog } = useStationSelection();
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const now = useMinuteClock();
  const { run, from, to } = shared;
  const pacificToday = agencyDateKey(now);
  const today = run.serviceDate === pacificToday;
  const future = run.serviceDate > pacificToday;
  const trips = useMemo(() => [trip], [trip]);
  const statusMap = useTripRealtimeStatusMap(
    today ? run.fromStation : "",
    today ? run.toStation : "",
    trips,
    run.serviceDate.replace(/-/g, ""),
  );
  const live = today ? findRealtimeStatus(statusMap, trip) : null;
  const { isCanceledOrSkipped } = useTripStatus(live);
  const arrivalAt = sharedTripArrival(run.serviceDate, tripEnds(trip), tripEnds(trip, live).end);
  const minutesUntilArrival = Math.ceil((arrivalAt - now.getTime()) / 60_000);
  const ended = now.getTime() >= arrivalAt;
  const canTake = !ended && !isCanceledOrSkipped && !live?.isDestinationSkipped;
  const alreadyTaking = sameFocusIdentity(focusedTrip, run);
  const android = !Capacitor.isNativePlatform() && /Android/i.test(navigator.userAgent);

  // The detail template reads wall time from the clock. Give it Pacific clock
  // fields even if the recipient is outside the service area.
  const detailClock = parseServiceDate(run.serviceDate);
  if (today) {
    const [hours, minutes] = agencyClockHHMM(now.getTime() / 1000).split(":").map(Number);
    detailClock.setHours(hours, minutes);
  } else if (!future) {
    detailClock.setHours(23, 59);
  }

  const progress = useTripProgress({
    trip,
    fromStation: run.fromStation,
    toStation: run.toStation,
    currentTime: detailClock,
    realtimeStatus: live,
    isNextTrip: false,
    trackVehicle: today,
  });

  const openMyTrip = () => {
    setSelectedTrip(null);
    const inAppHistory = hasInAppHistory(location.key);
    // A link opened in a fresh tab has nothing in-app behind it, so My Trip's
    // Back would leave the site; put the schedule there instead.
    if (!inAppHistory) navigate("/", { replace: true });
    navigate(TRIP_VIEW_PATH, { replace: inAppHistory });
  };

  const take = () => {
    if (!canTake) return;
    if (alreadyTaking) {
      openMyTrip();
      return;
    }
    void focusTrip(run);
    openMyTrip();
    const departureAt = focusedBoardingInstant(run, live?.liveDepartureTime);
    if (
      departureAt != null &&
      isReminderSupported() &&
      !reminderLeadRange(departureAt, Date.now()).tooLate
    ) {
      openReminderDialog();
    }
  };

  const actions = (canTake || android) ? (
    <div className="flex w-full min-w-0 flex-col gap-2">
      {canTake && (
        <Button className="h-11" onClick={() => {
          if (focusedTrip && !alreadyTaking) setConfirmSwitch(true);
          else take();
        }}>
          {t(alreadyTaking ? "focusedTrip.myTrip" : "shareTrip.take")}
        </Button>
      )}
      {android && (
        <Button asChild variant="outline" className="h-11">
          <a href={androidSharedTripIntent(sharedTripUrl(trip, run.scheduleType, run.serviceDate))}>
            {t("shareTrip.openApp")}
          </a>
        </Button>
      )}
    </div>
  ) : null;

  return (
    <>
      <TripDetailContent
        trip={trip}
        fromStation={run.fromStation}
        toStation={run.toStation}
        currentTime={detailClock}
        lastUpdated={today ? statusMap.lastUpdated : null}
        realtimeStatus={live}
        timeFormat="12h"
        isNextTrip={false}
        isOpen
        onClose={onBack}
        progress={{
          ...progress,
          isEnded: ended,
          headerBg: ended ? stateBg.past : progress.headerBg,
          minutesAfterArrival: -minutesUntilArrival,
          minutesUntilArrival: ended ? null : progress.minutesUntilArrival,
        }}
        scheduleType={run.scheduleType}
        futureServiceDate={future ? run.serviceDate : null}
        shared={{ from, to, serviceDate: run.serviceDate, now, minutesUntilArrival, actions }}
      />
      {confirmSwitch && focusedTrip && canTake && (
        <ConfirmDialog
          title={t("focusedTrip.switchTitle")}
          description={t("shareTrip.switchBody", {
            from, to, date: formatSharedServiceDate(run.serviceDate, i18n.language), train: run.tripNumber,
          })}
          secondaryLabel={t("focusedTrip.switchCancel")}
          onSecondary={() => setConfirmSwitch(false)}
          primaryLabel={t("focusedTrip.switchConfirm")}
          onPrimary={take}
          onDismiss={() => setConfirmSwitch(false)}
        />
      )}
    </>
  );
}
