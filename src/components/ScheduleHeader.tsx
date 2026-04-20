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
  const relative = t("schedule.updatedMinutesAgo", { count: diffMin });
  if (diffMin >= 10) {
    return `${relative} ${t("schedule.dataMayBeStale")}`;
  }
  return relative;
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
      <CardTitle
        id="schedule-results-title"
        className="flex items-center gap-2"
      >
        <span className="flex-1 min-w-0">
          {direction === "southbound"
            ? t("schedule.southboundSchedule")
            : t("schedule.northboundSchedule")}
        </span>
        <div className="max-w-[8.5rem] shrink-0 flex items-center gap-1 text-xs sm:text-sm text-muted-foreground text-right whitespace-normal break-words tracking-normal">
          <span>{updatedLabel}</span>
          <RefreshCw
            className="h-4 w-4 shrink-0 text-primary"
            aria-hidden="true"
          />
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
