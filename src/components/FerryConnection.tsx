import type { FerryConnection as FerryConnectionType } from "@/types/smartSchedule";
import { TimeDisplay } from "./TimeDisplay";
import { APP_CONSTANTS } from "@/lib/fareConstants";
import { Ship } from "lucide-react";
import { cn } from "@/lib/utils";
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
}

export function FerryConnection({
  ferry,
  minutes,
  isMobile = false,
  timeFormat = APP_CONSTANTS.DEFAULT_TIME_FORMAT,
  inbound = false,
  currentTime,
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
        "flex-grow flex items-center justify-end text-muted-foreground",
        isMobile ? "flex-row-reverse items-start gap-2 pt-2" : "gap-3"
      )}
    >
      <div className={cn("flex flex-col gap-1", isMobile ? "items-start" : "items-end")}>
        <div className="flex items-baseline gap-1 text-sm">
          <span className="text-muted-foreground">{compactLabel}</span>
          <TimeDisplay time={compactTime} format={timeFormat} />
        </div>
        <FerryTransfer minutes={minutes} className="gap-2 leading-none" />
      </div>
      <div
        className={cn(
          "flex flex-col justify-center items-center gap-1",
          isMobile ? "border-r pr-3 mr-1" : "border-l pl-4 ml-1"
        )}
      >
        <Ship className="h-5 w-5" />
        <span className="text-[10px] uppercase">
          {inbound ? t("ferry.inbound") : t("ferry.outbound")}
        </span>
      </div>
    </div>
  );
}
