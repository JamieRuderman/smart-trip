import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { CountdownLabel } from "./CountdownLabel";
import { ArrivalLabel } from "./ArrivalLabel";
import type { AlarmStatusSelection } from "@/lib/alarmStatus";

export function AlarmStatusLabel({
  status,
}: {
  status: AlarmStatusSelection;
}) {
  const { t } = useTranslation();

  const text = (() => {
    if (
      status.kind === "departure-countdown" &&
      status.minutesUntilDeparture != null
    ) {
      return <CountdownLabel minutesUntil={status.minutesUntilDeparture} />;
    }

    if (
      status.kind === "arrival-countdown" &&
      status.minutesUntilArrival != null
    ) {
      return <ArrivalLabel minutesUntilArrival={status.minutesUntilArrival} />;
    }

    return status.translationKey
      ? t(status.translationKey, status.translationValues)
      : "";
  })();

  return (
    <span
      className={cn(
        "text-2xl font-semibold",
        status.tone === "muted" ? "text-muted-foreground" : "text-foreground",
      )}
    >
      {text}
    </span>
  );
}
