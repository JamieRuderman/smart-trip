import { Button } from "@/components/ui/button";
import { CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { computeRealtimeAgeLabel } from "@/lib/realtimeAgeLabel";

interface ScheduleHeaderProps {
  direction: "southbound" | "northbound";
  currentTime: Date;
  nextTripIndex: number;
  showAllTrips: boolean;
  onToggleShowAllTrips: () => void;
  lastUpdated: Date | null;
  isError: boolean;
}

export function ScheduleHeader({
  direction,
  currentTime,
  nextTripIndex,
  showAllTrips,
  onToggleShowAllTrips,
  lastUpdated,
  isError,
}: ScheduleHeaderProps) {
  const { t } = useTranslation();
  const { text: updatedLabel, tone } = computeRealtimeAgeLabel(
    t,
    lastUpdated,
    currentTime,
    isError,
  );
  const isWarning = tone !== "fresh";

  return (
    <CardHeader className="p-3 md:p-6">
      <CardTitle
        id="schedule-results-title"
        className="flex items-center gap-2"
      >
        <span className="flex-1 min-w-0">
          {direction === "southbound"
            ? t("schedule.southboundSchedule")
            : t("schedule.northboundSchedule")}
        </span>
        <div
          className="shrink-0 flex items-center gap-1 text-xs sm:text-sm font-medium text-right tracking-normal text-muted-foreground"
          role={isWarning ? "status" : undefined}
        >
          <span>{updatedLabel}</span>
          {isWarning ? (
            <AlertTriangle
              className="h-4 w-4 shrink-0 text-smart-gold"
              strokeWidth={2}
              aria-hidden="true"
            />
          ) : (
            <RefreshCw
              className="h-4 w-4 shrink-0 text-primary"
              strokeWidth={2}
              aria-hidden="true"
            />
          )}
        </div>
      </CardTitle>
      {nextTripIndex > 0 && !showAllTrips && (
        <Button
          variant="outline"
          size="sm"
          className="!mt-6"
          onClick={onToggleShowAllTrips}
          aria-label={t("schedule.showEarlierTrains")}
        >
          {t("schedule.showEarlierTrains")}
        </Button>
      )}
      {showAllTrips && (
        <Button
          variant="outline"
          size="sm"
          className="!mt-6"
          onClick={onToggleShowAllTrips}
          aria-label={t("schedule.hideEarlierTrains")}
        >
          {t("schedule.hideEarlierTrains")}
        </Button>
      )}
    </CardHeader>
  );
}
