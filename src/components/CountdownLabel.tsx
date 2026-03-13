import { useTranslation } from "react-i18next";

/** Countdown text for the departure alarm row. */
export function CountdownLabel({ minutesUntil }: { minutesUntil: number }) {
  const { t } = useTranslation();

  if (minutesUntil > 60) {
    return t("tracker.departsInHoursMinutes", {
      hours: Math.floor(minutesUntil / 60),
      minutes: minutesUntil % 60,
    });
  }
  if (minutesUntil >= 2) {
    return t("tracker.departsInMinutes", { minutes: minutesUntil });
  }
  if (minutesUntil >= 0) {
    return t("tracker.nowBoarding");
  }
  return t("tracker.departedMinutesAgo", { minutes: Math.abs(minutesUntil) });
}
