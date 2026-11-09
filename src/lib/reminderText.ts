import type { TFunction } from "i18next";
import type { Station } from "@/types/smartSchedule";
import { formatClockTime } from "./timeUtils";

/**
 * The leave-reminder notification for a focused trip. Every path that arms or
 * re-arms the reminder builds it here, because a drift re-arm compares text to
 * stay idempotent — two differing copies would re-arm back and forth.
 */
export function buildReminderText(
  t: TFunction,
  language: string,
  {
    leadMinutes,
    departureAt,
    fromStation,
    tripNumber,
    byFerry,
    timeFormat,
  }: {
    leadMinutes: number;
    /** When the rider sets off: the train, or the SF ferry on a trip from SF. */
    departureAt: number;
    fromStation: Station;
    tripNumber: number;
    /** The trip starts with the SF ferry. */
    byFerry: boolean;
    timeFormat: "12h" | "24h";
  },
): { title: string; body: string } {
  const time = formatClockTime(departureAt, timeFormat, language);
  if (byFerry) {
    return {
      title: t("departureReminder.notificationTitle", {
        station: t("ferry.sfTerminal"),
      }),
      body: t("departureReminder.ferryNotificationBody", {
        leadMinutes,
        time,
        trip: tripNumber,
      }),
    };
  }
  return {
    title: t("departureReminder.notificationTitle", { station: fromStation }),
    body: t("departureReminder.notificationBody", {
      leadMinutes,
      station: fromStation,
      time,
      trip: tripNumber,
    }),
  };
}
