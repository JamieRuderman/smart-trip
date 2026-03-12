import { useTranslation } from "react-i18next";

/** Arrival countdown shown while the train is en route. */
export function ArrivalLabel({ minutesUntilArrival }: { minutesUntilArrival: number }) {
  const { t } = useTranslation();

  if (minutesUntilArrival <= 0) {
    return t("tracker.arrivingNow");
  }
  if (minutesUntilArrival > 60) {
    return t("tracker.arrivesInHoursMinutes", {
      hours: Math.floor(minutesUntilArrival / 60),
      minutes: minutesUntilArrival % 60,
    });
  }
  return t("tracker.arrivesInMinutes", { minutes: minutesUntilArrival });
}
