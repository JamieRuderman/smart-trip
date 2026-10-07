import { useTranslation } from "react-i18next";
import { Clock, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { CountdownLabel } from "./CountdownLabel";
import { LeaveLabel } from "./LeaveLabel";
import { ArrivalLabel } from "./ArrivalLabel";
import { TripIcon } from "./icons/TripIcon";
import { WalkIcon } from "./icons/WalkIcon";
import type { AlarmStatusSelection } from "@/lib/alarmStatus";
import { stateText } from "@/lib/tripTheme";

export function AlarmStatusLabel({
  status,
  className,
}: {
  status: AlarmStatusSelection;
  /** Overrides the default headline size/colour (e.g. white on a coloured band). */
  className?: string;
}) {
  const { t } = useTranslation();

  const text = (() => {
    if (
      status.kind === "leave-countdown" &&
      status.minutesUntilLeave != null
    ) {
      return <LeaveLabel minutesUntilLeave={status.minutesUntilLeave} />;
    }

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
        "text-[1.7rem] leading-tight font-semibold tracking-[-0.02em]",
        status.tone === "muted" ? stateText.future : stateText.future,
        className,
      )}
    >
      {text}
    </span>
  );
}

/** The glyph that leads an alarm status: walk (leave), train (departs), pin
 *  (arrives), or a clock for the message states. */
export function AlarmStatusIcon({
  status,
  className,
}: {
  status: AlarmStatusSelection;
  className?: string;
}) {
  const Icon =
    status.kind === "leave-countdown"
      ? WalkIcon
      : status.kind === "departure-countdown"
        ? TripIcon
        : status.kind === "arrival-countdown"
          ? MapPin
          : Clock;
  return <Icon className={className} aria-hidden="true" />;
}
