import type { FerryConnection as FerryConnectionType } from "@/types/smartSchedule";
import { TimeDisplay } from "./TimeDisplay";
import { APP_CONSTANTS, FARE_CONSTANTS } from "@/lib/fareConstants";
import { Ship, AlertTriangle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { stateText } from "@/lib/tripTheme";
import { isTimeInPast } from "@/lib/scheduleUtils";
import { calculateTimeDifference } from "@/lib/timeUtils";
import { useTranslation } from "react-i18next";

interface FerryConnectionProps {
  ferry: FerryConnectionType;
  trainArrivalTime?: string; // for outbound (train -> ferry)
  trainDepartureTime?: string; // for inbound (ferry -> train)
  isMobile?: boolean;
  timeFormat?: "12h" | "24h";
  inbound?: boolean; // when true, show ferry arrival then train departure
  currentTime?: Date;
  /** Show both ends of the ferry leg (Larkspur → SF). Used in the trip detail
   *  card where there's room. The compact schedule listing leaves this off and
   *  shows only the Larkspur-side connection time. */
  fullLeg?: boolean;
}

export function FerryConnection({
  ferry,
  trainArrivalTime,
  trainDepartureTime,
  isMobile = false,
  timeFormat = APP_CONSTANTS.DEFAULT_TIME_FORMAT,
  inbound = false,
  currentTime,
  fullLeg = false,
}: FerryConnectionProps) {
  const { t } = useTranslation();

  let transferTime = 0;

  if (inbound) {
    if (trainDepartureTime) {
      transferTime = calculateTimeDifference(ferry.arrive, trainDepartureTime);
    }
  } else {
    if (trainArrivalTime) {
      transferTime = calculateTimeDifference(trainArrivalTime, ferry.depart);
    }
  }

  const isShortConnection =
    transferTime < FARE_CONSTANTS.QUICK_CONNECTION_THRESHOLD;

  // ferry.depart / ferry.arrive are always in travel order; only the terminal
  // names flip by direction. Outbound runs Larkspur → SF, inbound SF → Larkspur.
  const originName = inbound ? t("ferry.sanFrancisco") : t("ferry.larkspur");
  const destName = inbound ? t("ferry.larkspur") : t("ferry.sanFrancisco");
  // Full leg mutes the boarding (departure) end once the ferry has left.
  const boardingHasPassed =
    currentTime != null && isTimeInPast(currentTime, ferry.depart);

  // Compact (listing) view: the single Larkspur-side connection time — catch it
  // (outbound) or step off it (inbound) — with a tense-aware label.
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
        {fullLeg ? (
          <div
            className={cn(
              "flex items-baseline gap-2 whitespace-nowrap",
              isMobile ? "text-sm" : "text-base"
            )}
          >
            <span className="flex items-baseline gap-1">
              <span className="text-[10px] uppercase text-muted-foreground">
                {originName}
              </span>
              <TimeDisplay
                time={ferry.depart}
                format={timeFormat}
                className={cn(boardingHasPassed && "text-muted-foreground/70")}
              />
            </span>
            <span aria-hidden="true">→</span>
            <span className="flex items-baseline gap-1">
              <TimeDisplay time={ferry.arrive} format={timeFormat} />
              <span className="text-[10px] uppercase text-muted-foreground">
                {destName}
              </span>
            </span>
          </div>
        ) : (
          <div className="flex items-baseline gap-1 text-sm">
            <span className="text-muted-foreground">{compactLabel}</span>
            <TimeDisplay time={compactTime} format={timeFormat} />
          </div>
        )}
        <div
          className={cn(
            "flex items-center gap-2 text-xs leading-none",
            isShortConnection && cn(stateText["delayed"], "font-medium")
          )}
        >
          {isShortConnection ? (
            <AlertTriangle className="h-3 w-3" />
          ) : (
            <Clock className="h-3 w-3" />
          )}
          {transferTime} {t("ferry.minTransfer")}
        </div>
      </div>
      <div
        className={cn(
          "flex flex-col justify-center items-center gap-1",
          isMobile ? "border-r pr-3 mr-1" : "border-l pl-4 ml-1"
        )}
      >
        <Ship className="h-5 w-5" />
        {/* In the full-leg mobile view the Lark → SF ordering already conveys
            direction, so the word would only be redundant width; show it
            everywhere else (compact listing, and any desktop view). */}
        {(!fullLeg || !isMobile) && (
          <span className="text-[10px] uppercase">
            {inbound ? t("ferry.inbound") : t("ferry.outbound")}
          </span>
        )}
      </div>
    </div>
  );
}
