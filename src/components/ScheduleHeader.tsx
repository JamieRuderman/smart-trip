import { Button } from "@/components/ui/button";
import { CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { computeRealtimeAgeLabel } from "@/lib/realtimeAgeLabel";
import { cn } from "@/lib/utils";

interface ScheduleHeaderProps {
  direction: "southbound" | "northbound";
  currentTime: Date;
  /** Which earlier-trains button to offer, if any: "show" while departed rows
   *  are hidden above the list, "hide" once they're expanded. */
  earlierTrainsToggle: "show" | "hide" | null;
  onToggleShowAllTrips: () => void;
  /** False on a schedule that isn't today's: its rows carry no live data, so a
   *  "Just now" freshness readout would imply otherwise. */
  showLiveStatus?: boolean;
  lastUpdated: Date | null;
  /** True when the live feed is failing (any reason) — with no cached timestamp
   *  this shows "Live data unavailable" instead of a perpetual "loading". */
  isFeedUnavailable?: boolean;
}

export function ScheduleHeader({
  direction,
  currentTime,
  earlierTrainsToggle,
  onToggleShowAllTrips,
  showLiveStatus = true,
  lastUpdated,
  isFeedUnavailable = false,
}: ScheduleHeaderProps) {
  const { t } = useTranslation();
  const { text: updatedLabel, isStale } = computeRealtimeAgeLabel(
    t,
    lastUpdated,
    currentTime,
    isFeedUnavailable,
  );

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
        {showLiveStatus && (
          <div
            className={cn(
              "shrink-0 flex items-center gap-1 text-xs sm:text-sm font-medium text-right tracking-normal",
              isStale ? "text-smart-gold" : "text-muted-foreground",
            )}
            role={isStale ? "status" : undefined}
          >
            <span>{updatedLabel}</span>
            {isStale ? (
              <AlertTriangle
                className="h-4 w-4 shrink-0"
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
        )}
      </CardTitle>
      {earlierTrainsToggle === "show" && (
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
      {earlierTrainsToggle === "hide" && (
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
