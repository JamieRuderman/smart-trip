import { Button } from "@/components/ui/button";
import { CardHeader, CardTitle } from "@/components/ui/card";
import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ScheduleHeaderProps {
  direction: "southbound" | "northbound";
  currentTime: Date;
  timeFormat: "12h" | "24h";
  nextTripIndex: number;
  showAllTrips: boolean;
  onToggleShowAllTrips: () => void;
}

export function ScheduleHeader({
  direction,
  currentTime,
  timeFormat,
  nextTripIndex,
  showAllTrips,
  onToggleShowAllTrips,
}: ScheduleHeaderProps) {
  const { t } = useTranslation();

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
          {currentTime.toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
            hour12: timeFormat === "12h",
          })}
          <Clock
            className="inline-block h-5 w-5 text-primary"
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
