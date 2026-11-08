import { Ship } from "lucide-react";
import { useTranslation } from "react-i18next";

import { TimeDisplay, formatTime } from "@/components/TimeDisplay";
import { FERRY_CONSTANTS } from "@/lib/fareConstants";
import { SAN_FRANCISCO, type Place } from "@/lib/places";
import { upcomingFerries } from "@/lib/scheduleUtils";
import { stationTrackColor } from "@/lib/stationUtils";
import { minutesOfDay, parseTimeToMinutes } from "@/lib/timeUtils";
import { stateCardStyle } from "@/lib/tripTheme";
import { cn } from "@/lib/utils";
import { FerryScheduleLink } from "./FerryLeg";
import { PlaceSheet } from "./StationInfoSheet";

const MAX_FERRIES = 6;

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
}: FerryTerminalSheetProps) {
  const { t } = useTranslation();
  const nowMinutes = minutesOfDay(currentTime);
  const ferries = upcomingFerries(currentTime, true).slice(0, MAX_FERRIES);

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
            return (
              <li
                key={ferry.depart}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg border",
                  stateCardStyle.future,
                )}
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
              </li>
            );
          })}
        </ul>
      )}
      <FerryScheduleLink className="mt-4 text-xs text-muted-foreground" />
    </PlaceSheet>
  );
}
