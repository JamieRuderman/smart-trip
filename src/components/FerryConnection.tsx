import type { FerryConnection as FerryConnectionType } from "@/types/smartSchedule";
import { TimeDisplay } from "./TimeDisplay";
import { APP_CONSTANTS } from "@/lib/fareConstants";
import { Ship } from "lucide-react";
import { cn } from "@/lib/utils";
import { stateText } from "@/lib/tripTheme";
import { isTimeInPast } from "@/lib/scheduleUtils";
import { FerryTransfer } from "./FerryLeg";
import { useTranslation } from "react-i18next";

interface FerryConnectionProps {
  ferry: FerryConnectionType;
  /** Minutes between train and ferry at Larkspur. */
  minutes: number;
  isMobile?: boolean;
  timeFormat?: "12h" | "24h";
  inbound?: boolean; // when true, show ferry arrival then train departure
  currentTime?: Date;
  /** The train has left: fade the line with the rest of the row. */
  isPast?: boolean;
}

export function FerryConnection({
  ferry,
  minutes,
  isMobile = false,
  timeFormat = APP_CONSTANTS.DEFAULT_TIME_FORMAT,
  inbound = false,
  currentTime,
  isPast = false,
}: FerryConnectionProps) {
  const { t } = useTranslation();

  // The single Larkspur-side connection time — catch it (outbound) or step off
  // it (inbound) — with a tense-aware label.
  const compactTime = inbound ? ferry.arrive : ferry.depart;
  const compactTimePassed =
    currentTime != null && isTimeInPast(currentTime, compactTime);
  const compactLabel = inbound
    ? compactTimePassed
      ? t("ferry.arrived")
      : t("ferry.arrives")
    : compactTimePassed
      ? t("ferry.departed")
      : t("ferry.departs");

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 text-xs",
        isPast ? stateText.past : "text-muted-foreground",
        isMobile ? "pt-1" : "flex-grow justify-end",
      )}
    >
      <span className="flex items-center gap-1 whitespace-nowrap">
        <Ship className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {compactLabel}
        <TimeDisplay time={compactTime} format={timeFormat} />
      </span>
      <FerryTransfer
        minutes={minutes}
        className={cn("gap-1 whitespace-nowrap", isPast && stateText.past)}
      />
    </div>
  );
}
