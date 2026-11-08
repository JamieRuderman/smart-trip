import { ExternalLink, Ship, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AppSheet } from "@/components/ui/app-sheet";
import { TimeDisplay, formatTime } from "@/components/TimeDisplay";
import { FERRY_CONSTANTS } from "@/lib/fareConstants";
import { SAN_FRANCISCO, type Place } from "@/lib/places";
import { ferryRuns, getTodayScheduleType } from "@/lib/scheduleUtils";
import { stationTrackColor } from "@/lib/stationUtils";
import { minutesOfDay, parseTimeToMinutes } from "@/lib/timeUtils";
import { stateCardStyle } from "@/lib/tripTheme";
import { cn } from "@/lib/utils";
import { FromToColumn, RouteSummary } from "./StationInfoSheet";

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
  const color = stationTrackColor("Larkspur");
  const nowMinutes = minutesOfDay(currentTime);
  const ferries = ferryRuns(getTodayScheduleType(currentTime), true)
    .filter((f) => parseTimeToMinutes(f.depart) >= nowMinutes)
    .slice(0, MAX_FERRIES);

  return (
    <AppSheet
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={t("stationInfo.ferryTerminalAria")}
      handleSlot={
        <div
          className="flex justify-center pt-3 pb-1 shrink-0"
          style={{ backgroundColor: color }}
        >
          <div className="w-10 h-1 rounded-full bg-white/40" />
        </div>
      }
    >
      <div
        className="px-5 pt-2 pb-4 flex items-start justify-between gap-4 shrink-0"
        style={{ backgroundColor: color }}
      >
        <div className="min-w-0">
          <p className="text-xs font-bold tracking-widest uppercase text-white/80">
            {t("stationInfo.ferryLabel")}
          </p>
          <h2 className="mt-0.5 text-2xl font-bold text-white">
            {SAN_FRANCISCO}
          </h2>
          {fromStation && toStation && (
            <RouteSummary from={fromStation} to={toStation} here={SAN_FRANCISCO} />
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2 -mr-1 rounded-full text-white hover:bg-white/20 transition-colors shrink-0"
          aria-label={t("stationInfo.close")}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {(onSetFrom || onSetTo) && (
        <div className="px-5 pt-4 pb-4 flex gap-3">
          {onSetFrom && (
            <FromToColumn
              role="from"
              isCurrent={fromStation === SAN_FRANCISCO}
              onClick={() =>
                fromStation === SAN_FRANCISCO
                  ? onClearFrom?.()
                  : onSetFrom(SAN_FRANCISCO)
              }
            />
          )}
          {onSetTo && (
            <FromToColumn
              role="to"
              isCurrent={toStation === SAN_FRANCISCO}
              onClick={() =>
                toStation === SAN_FRANCISCO
                  ? onClearTo?.()
                  : onSetTo(SAN_FRANCISCO)
              }
            />
          )}
        </div>
      )}

      <div className="border-t border-border" />

      <div className="px-5 pt-4 pb-6 overflow-auto" data-sheet-scroll-area="true">
        <h3 className="text-xs font-bold tracking-widest uppercase text-muted-foreground mb-3">
          {t("stationInfo.nextFerries")}
        </h3>
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
        <a
          href={FERRY_CONSTANTS.SCHEDULE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
        >
          {t("ferry.goldenGateSchedule")}
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      </div>
    </AppSheet>
  );
}
