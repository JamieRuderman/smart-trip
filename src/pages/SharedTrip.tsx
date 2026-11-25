import { useLayoutEffect, useMemo, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { TripPageView } from "@/components/TripPageView";
import { TripIcon } from "@/components/icons/TripIcon";
import { Button } from "@/components/ui/button";
import { useStationSelection } from "@/contexts/stationSelection";
import { useMinuteClock } from "@/hooks/useMinuteClock";
import { useScheduleData, useScheduleRefreshing } from "@/hooks/useScheduleData";
import { useMyTripState } from "@/hooks/useMyTrip";
import { findRealtimeStatus, useTripRealtimeStatusMap } from "@/hooks/useTripUpdates";
import {
  reconstructFocusedTrip,
  sameFocusIdentity,
} from "@/lib/focusedTrip";
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
import { hasInAppHistory, TRIP_VIEW_PATH } from "@/lib/tripView";
import { bandPrimaryButtonStyle } from "@/lib/tripTheme";

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

  // useGoBack's fallback keeps the query, which here is the shared link's.
  const goBack = () => {
    if (hasInAppHistory()) navigate(-1);
    else navigate("/", { replace: true });
  };

  if (shared && trip && matchesSharedDeparture(shared, trip)) {
    return <SharedItinerary key={location.search} shared={shared} trip={trip} onBack={goBack} />;
  }
  return (
    <main className="flex min-h-[100dvh] flex-col bg-card"
      style={{ paddingBottom: "max(var(--safe-area-bottom), env(safe-area-inset-bottom, 0px))" }}>
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
    </main>
  );
}

function SharedItinerary({ shared, trip, onBack }: {
  shared: SharedTripData;
  trip: ProcessedTrip;
  onBack: () => void;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { focusedTrip, focusTrip, setPreviewTrip } = useStationSelection();
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
  const arrivalAt = sharedTripArrival(run.serviceDate, tripEnds(trip), tripEnds(trip, live).end);
  const alreadyTaking = sameFocusIdentity(focusedTrip, run);
  const android = !Capacitor.isNativePlatform() && /Android/i.test(navigator.userAgent);

  // Pacific clock fields even outside the service area: now on today's run, the
  // end of a past run's day, or Pacific today (read as a later day) for a later run.
  const clock = parseServiceDate(future ? pacificToday : run.serviceDate);
  if (today) {
    const [hours, minutes] = agencyClockHHMM(now.getTime() / 1000).split(":").map(Number);
    clock.setHours(hours, minutes);
  } else if (!future) {
    clock.setHours(23, 59);
  }

  const state = useMyTripState({
    focusedTrip: { source: "user", ...run, reminder: null },
    trip,
    live,
    lastUpdated: today ? statusMap.lastUpdated : null,
    currentTime: clock,
    isPreview: true,
    itineraryArrivalAt: arrivalAt,
    realtimeClock: now,
  });
  const canTake = !state.progress.isEnded && !state.model.isCanceledOrSkipped;

  const take = () => {
    if (!canTake) return;
    if (!alreadyTaking) void focusTrip(run);
    setPreviewTrip(null);
    navigate(TRIP_VIEW_PATH, { replace: true });
  };

  const actions = (canTake || android) ? (
    <div className="flex w-full min-w-0 flex-col gap-2">
      {canTake && (
        <Button
          className={bandPrimaryButtonStyle}
          onClick={() => {
            if (focusedTrip && !alreadyTaking) setConfirmSwitch(true);
            else take();
          }}
        >
          <TripIcon className="h-5 w-5" aria-hidden="true" />
          {t(alreadyTaking ? "focusedTrip.myTrip" : "shareTrip.take")}
        </Button>
      )}
      {android && (
        <Button
          asChild
          className="h-11 rounded-xl bg-white/15 text-white hover:bg-white/25"
        >
          <a href={androidSharedTripIntent(sharedTripUrl(trip, run.scheduleType, run.serviceDate))}>
            {t("shareTrip.openApp")}
          </a>
        </Button>
      )}
    </div>
  ) : null;

  return (
    <>
      <TripPageView
        state={state}
        onBack={onBack}
        actions={actions}
        markHomeStops={false}
        dateLine={t("shareTrip.pacificDate", {
          date: formatSharedServiceDate(run.serviceDate, i18n.language),
        })}
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
