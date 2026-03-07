import { Button } from "@/components/ui/button";
import { CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ScheduleHeaderProps {
  direction: "southbound" | "northbound";
  currentTime: Date;
  nextTripIndex: number;
  showAllTrips: boolean;
  onToggleShowAllTrips: () => void;
  lastUpdated: Date | null;
}

function computeLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  lastUpdated: Date | null,
  currentTime: Date
): string {
  if (!lastUpdated) return t("schedule.lastUpdatedLoading");
  const diffMs = currentTime.getTime() - lastUpdated.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return t("schedule.updatedJustNow");
  return t("schedule.updatedMinutesAgo", { count: diffMin });
}

export function ScheduleHeader({
  direction,
  currentTime,
  nextTripIndex,
  showAllTrips,
  onToggleShowAllTrips,
  lastUpdated,
}: ScheduleHeaderProps) {
  const { t } = useTranslation();
  const updatedLabel = computeLabel(t, lastUpdated, currentTime);

  return (
    <CardHeader className="p-3 md:p-6">
      <CardTitle id="schedule-results-title" className="flex items-center gap-2">
        {direction === "southbound"
          ? t("schedule.southboundSchedule")
          : t("schedule.northboundSchedule")}
        <div className="flex-grow flex justify-end items-center gap-2 text-sm text-muted-foreground whitespace-nowrap">
          {updatedLabel}
          <RefreshCw className="inline-block h-4 w-4 text-primary" aria-hidden="true" />
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
