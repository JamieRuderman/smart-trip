import { CalendarClock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { serviceDateWeekdayLabel } from "@/lib/timeUtils";

interface FutureScheduleNoticeProps {
  scheduleType: "weekday" | "weekend";
  /** The day ("YYYY-MM-DD") the schedule next runs. */
  serviceDate: string;
}

/** Shown above the list when the picked schedule isn't today's, so the full,
 *  unfiltered timetable reads as a later day's trains, not today's. */
export function FutureScheduleNotice({
  scheduleType,
  serviceDate,
}: FutureScheduleNoticeProps) {
  const { t, i18n } = useTranslation();

  return (
    <Alert role="status" className="mb-3 bg-muted">
      <CalendarClock className="h-4 w-4" />
      <AlertTitle>{t("futureSchedule.title")}</AlertTitle>
      <AlertDescription className="text-muted-foreground">
        {t(
          scheduleType === "weekend"
            ? "futureSchedule.bodyWeekend"
            : "futureSchedule.bodyWeekday",
          { day: serviceDateWeekdayLabel(serviceDate, i18n.language) },
        )}
      </AlertDescription>
    </Alert>
  );
}
