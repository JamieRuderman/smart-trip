import { CalendarClock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { nextServiceDate } from "@/lib/scheduleUtils";
import { serviceDateWeekdayLabel } from "@/lib/timeUtils";

interface FutureScheduleNoticeProps {
  scheduleType: "weekday" | "weekend";
  currentTime: Date;
}

/** Shown above the list when the picked schedule isn't today's, so the full,
 *  unfiltered timetable reads as a later day's trains, not today's. */
export function FutureScheduleNotice({
  scheduleType,
  currentTime,
}: FutureScheduleNoticeProps) {
  const { t, i18n } = useTranslation();
  const day = serviceDateWeekdayLabel(
    nextServiceDate(currentTime, scheduleType),
    i18n.language,
  );

  return (
    <Alert aria-live="polite" className="mb-3 bg-muted">
      <CalendarClock className="h-4 w-4" />
      <AlertTitle>{t("futureSchedule.title")}</AlertTitle>
      <AlertDescription className="text-muted-foreground">
        {t(
          scheduleType === "weekend"
            ? "futureSchedule.bodyWeekend"
            : "futureSchedule.bodyWeekday",
          { day },
        )}
      </AlertDescription>
    </Alert>
  );
}
