import { useMemo } from "react";
import { Ship } from "lucide-react";
import { useTranslation } from "react-i18next";

import stations from "@/data/stations";
import { TimeDisplay, formatTime } from "@/components/TimeDisplay";
import { useStationSelection } from "@/contexts/stationSelection";
import { FERRY_CONSTANTS } from "@/lib/fareConstants";
import { focusedPlaces, isFocusedTrainToday } from "@/lib/focusedTrip";
import { SAN_FRANCISCO, type Place } from "@/lib/places";
import {
  getFilteredTrips,
  getTodayScheduleType,
  upcomingFerries,
  type ProcessedTrip,
} from "@/lib/scheduleUtils";
import { stationTrackColor } from "@/lib/stationUtils";
import { minutesOfDay, parseTimeToMinutes } from "@/lib/timeUtils";
import { myTripCardStyle, stateCardStyle } from "@/lib/tripTheme";
import type { Station } from "@/types/smartSchedule";
import { FerryScheduleLink } from "./FerryLeg";
import { PlaceSheet, PlaceSheetRow } from "./StationInfoSheet";

const MAX_FERRIES = 6;
const WINDSOR = stations[0];

export interface FerryTerminalSheetProps {
  isOpen: boolean;
  onClose: () => void;
  currentTime: Date;
  fromStation?: Place | null;
  toStation?: Place | null;
  onSetFrom?: (place: Place) => void;
  onSetTo?: (place: Place) => void;
  onClearFrom?: () => void;
  onClearTo?: () => void;
  /** Open the trip sheet for the train a ferry connects to, from Larkspur —
   *  where its ferry leg begins — to the end of the line. */
  onFerryClick?: (trip: ProcessedTrip, fromStation: Station, toStation: Station) => void;
}

/**
 * The San Francisco ferry terminus on the line map — picked as a trip end like
 * a station, with the next ferries leaving for Larkspur in place of train
 * arrivals. Presents like {@link StationInfoSheet}.
 */
export function FerryTerminalSheet({
  isOpen,
  onClose,
  currentTime,
  fromStation = null,
  toStation = null,
  onSetFrom,
  onSetTo,
  onClearFrom,
  onClearTo,
  onFerryClick,
}: FerryTerminalSheetProps) {
  const { t } = useTranslation();
  const { focusedTrip } = useStationSelection();
  const nowMinutes = minutesOfDay(currentTime);
  const ferries = upcomingFerries(currentTime, true).slice(0, MAX_FERRIES);
  const scheduleType = getTodayScheduleType(currentTime);

  // Two trains can share a ferry; a row opens the earlier, the one it's timed for.
  const connectingTrains = useMemo(() => {
    const byFerry = new Map<string, ProcessedTrip>();
    for (const trip of getFilteredTrips(
      FERRY_CONSTANTS.FERRY_STATION,
      WINDSOR,
      scheduleType,
      true,
    )) {
      if (trip.inboundFerry && !byFerry.has(trip.inboundFerry.depart)) {
        byFerry.set(trip.inboundFerry.depart, trip);
      }
    }
    return byFerry;
  }, [scheduleType]);

  return (
    <PlaceSheet
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={t("stationInfo.ferryTerminalAria")}
      color={stationTrackColor(FERRY_CONSTANTS.FERRY_STATION)}
      eyebrow={t("stationInfo.ferryLabel")}
      place={SAN_FRANCISCO}
      fromStation={fromStation}
      toStation={toStation}
      onSetFrom={onSetFrom}
      onSetTo={onSetTo}
      onClearFrom={onClearFrom}
      onClearTo={onClearTo}
      heading={t("stationInfo.nextFerries")}
    >
      {ferries.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          {t("stationInfo.noMoreFerries")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ferries.map((ferry) => {
            const etaMinutes = parseTimeToMinutes(ferry.depart) - nowMinutes;
            const train = connectingTrains.get(ferry.depart);
            const isFocused =
              train != null &&
              isFocusedTrainToday(focusedTrip, train.trip, false, currentTime) &&
              focusedPlaces(focusedTrip).from === SAN_FRANCISCO;
            return (
              <PlaceSheetRow
                key={ferry.depart}
                tone={isFocused ? myTripCardStyle : stateCardStyle.future}
                onClick={
                  train && onFerryClick
                    ? () => onFerryClick(train, FERRY_CONSTANTS.FERRY_STATION, WINDSOR)
                    : undefined
                }
                ariaLabel={t("stationInfo.openTripAria", {
                  trip: train?.trip,
                  terminus: WINDSOR,
                })}
              >
                <Ship className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="flex-1 min-w-0 leading-tight">
                  <div className="text-sm font-medium text-muted-foreground">
                    {ferry.sfGate
                      ? t("ferry.gate", { gate: ferry.sfGate })
                      : t("ferry.sfTerminal")}
                  </div>
                  <div className="text-xs tabular-nums mt-0.5 text-muted-foreground">
                    {etaMinutes <= 0
                      ? t("stationInfo.nowArriving")
                      : etaMinutes >= 60
                        ? t("stationInfo.inHoursMinutes", {
                            hours: Math.floor(etaMinutes / 60),
                            minutes: etaMinutes % 60,
                          })
                        : t("stationInfo.inMinutes", { minutes: etaMinutes })}
                  </div>
                </div>
                <div className="shrink-0 text-right leading-tight">
                  <div className="text-xl font-semibold tabular-nums">
                    <TimeDisplay time={ferry.depart} />
                  </div>
                  <div className="text-xs tabular-nums mt-0.5 text-muted-foreground">
                    {t("stationInfo.arrivesLarkspur", {
                      time: formatTime(ferry.arrive),
                    })}
                  </div>
                </div>
              </PlaceSheetRow>
            );
          })}
        </ul>
      )}
      <FerryScheduleLink className="mt-4 text-xs text-muted-foreground" />
    </PlaceSheet>
  );
}
