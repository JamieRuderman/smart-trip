import { Button } from "@/components/ui/button";
import { CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";

interface ScheduleHeaderProps {
  direction: "southbound" | "northbound";
  currentTime: Date;
  timeFormat: "12h" | "24h";
  nextTripIndex: number;
  showAllTrips: boolean;
  onToggleShowAllTrips: () => void;
  lastUpdated: Date | null;
}

function useLastUpdatedLabel(lastUpdated: Date | null, currentTime: Date): string {
  const [label, setLabel] = useState<string>(() => computeLabel(lastUpdated, currentTime));

  useEffect(() => {
    setLabel(computeLabel(lastUpdated, currentTime));
  }, [lastUpdated, currentTime]);

  return label;
}

function computeLabel(lastUpdated: Date | null, currentTime: Date): string {
  if (!lastUpdated) return "Loading…";
  const diffMs = currentTime.getTime() - lastUpdated.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Updated just now";
  if (diffMin === 1) return "Updated 1 min ago";
  return `Updated ${diffMin} min ago`;
}

export function ScheduleHeader({
  direction,
  currentTime,
  timeFormat: _timeFormat,
  nextTripIndex,
  showAllTrips,
  onToggleShowAllTrips,
  lastUpdated,
}: ScheduleHeaderProps) {
  const { t } = useTranslation();
  const updatedLabel = useLastUpdatedLabel(lastUpdated, currentTime);

  return (
    <CardHeader className="p-3 md:p-6">
      <CardTitle
        id="schedule-results-title"
        className="flex items-center gap-2"
      >
        {direction === "southbound"
          ? t("schedule.southboundSchedule")
          : t("schedule.northboundSchedule")}
        <div className="flex-grow flex justify-end items-center gap-2 text-sm text-muted-foreground whitespace-nowrap">
          {updatedLabel}
          <RefreshCw
            className="inline-block h-4 w-4 text-primary"
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
