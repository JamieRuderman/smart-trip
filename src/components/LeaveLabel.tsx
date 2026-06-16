import { useTranslation } from "react-i18next";

/** Countdown to when the user should head out — i.e. their armed leave
 *  reminder/alarm. The first of the three pinned-trip stages (leave → departs →
 *  arrives), mirroring the Live Activity. */
export function LeaveLabel({ minutesUntilLeave }: { minutesUntilLeave: number }) {
  const { t } = useTranslation();

  if (minutesUntilLeave > 60) {
    return t("tracker.leaveInHoursMinutes", {
      hours: Math.floor(minutesUntilLeave / 60),
      minutes: minutesUntilLeave % 60,
    });
  }
  if (minutesUntilLeave >= 1) {
    return t("tracker.leaveInMinutes", { minutes: minutesUntilLeave });
  }
  return t("tracker.leaveNow");
}
