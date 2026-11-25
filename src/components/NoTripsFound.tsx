import { Card, CardContent } from "@/components/ui/card";
import { useTranslation } from "react-i18next";

interface NoTripsFoundProps {
  scheduleType: "weekday" | "weekend";
  onScheduleTypeChange: (type: "weekday" | "weekend") => void;
}

export function NoTripsFound({ scheduleType, onScheduleTypeChange }: NoTripsFoundProps) {
  const { t } = useTranslation();

  return (
    <Card
      className="text-center py-8 max-w-4xl mx-auto"
      role="status"
      aria-live="polite"
    >
      <CardContent>
        <p className="text-muted-foreground">{t("noTripsFound.noTrainsFound")}</p>
        <button
          type="button"
          onClick={() =>
            onScheduleTypeChange(scheduleType === "weekday" ? "weekend" : "weekday")
          }
          className="mt-2 text-sm font-medium text-primary underline-offset-2 hover:underline"
        >
          {t(scheduleType === "weekday" ? "schedule.showWeekend" : "schedule.showWeekday")}
        </button>
      </CardContent>
    </Card>
  );
}
