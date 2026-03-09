import { useTranslation } from "react-i18next";

/** Arrival countdown shown while the train is en route. */
export function ArrivalLabel({ minutesUntilArrival }: { minutesUntilArrival: number }) {
  const { t } = useTranslation();

  if (minutesUntilArrival <= 0) {
    return (
      <span className="text-2xl font-semibold">
        {t("tracker.arrivingNow")}
      </span>
    );
  }
  if (minutesUntilArrival > 60) {
    return (
      <span className="text-2xl font-semibold">
        {t("tracker.arrivesInHoursMinutes", {
          hours: Math.floor(minutesUntilArrival / 60),
          minutes: minutesUntilArrival % 60,
        })}
      </span>
    );
  }
  return (
    <span className="text-2xl font-semibold">
      {t("tracker.arrivesInMinutes", { minutes: minutesUntilArrival })}
    </span>
  );
}
