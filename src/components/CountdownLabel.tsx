import { useTranslation } from "react-i18next";

/** Countdown text for the departure alarm row. */
export function CountdownLabel({
  minutesUntil,
  ferry = false,
}: {
  minutesUntil: number;
  /** Counting down to the SF ferry rather than the train. */
  ferry?: boolean;
}) {
  const { t } = useTranslation();

  if (minutesUntil > 60) {
    return t(ferry ? "tracker.ferryDepartsInHoursMinutes" : "tracker.departsInHoursMinutes", {
      hours: Math.floor(minutesUntil / 60),
      minutes: minutesUntil % 60,
    });
  }
  if (minutesUntil >= 2) {
    return t(ferry ? "tracker.ferryDepartsInMinutes" : "tracker.departsInMinutes", {
      minutes: minutesUntil,
    });
  }
  if (minutesUntil >= 0) {
    return t("tracker.nowBoarding");
  }
  return t("tracker.departedMinutesAgo", { minutes: Math.abs(minutesUntil) });
}
