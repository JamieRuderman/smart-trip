import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { stateText } from "@/lib/tripTheme";

/** Countdown text for the departure alarm row. */
export function CountdownLabel({ minutesUntil }: { minutesUntil: number }) {
  const { t } = useTranslation();

  if (minutesUntil > 60) {
    return (
      <span className="text-2xl font-semibold">
        {t("tracker.departsInHoursMinutes", {
          hours: Math.floor(minutesUntil / 60),
          minutes: minutesUntil % 60,
        })}
      </span>
    );
  }
  if (minutesUntil >= 2) {
    return (
      <span className="text-2xl font-semibold">
        {t("tracker.departsInMinutes", { minutes: minutesUntil })}
      </span>
    );
  }
  if (minutesUntil >= 0) {
    return (
      <span className={cn("text-2xl font-semibold", stateText["ontime"])}>
        {t("tracker.nowBoarding")}
      </span>
    );
  }
  return (
    <span className="text-base text-muted-foreground">
      {t("tracker.departedMinutesAgo", { minutes: Math.abs(minutesUntil) })}
    </span>
  );
}
