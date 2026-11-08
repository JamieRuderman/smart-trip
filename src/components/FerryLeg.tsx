import { useId, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Circle,
  Clock,
  ExternalLink,
  Ship,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { FERRY_CONSTANTS } from "@/lib/fareConstants";
import { adjacentFerry } from "@/lib/scheduleUtils";
import { calculateTimeDifference, isQuickConnection } from "@/lib/timeUtils";
import { stateIconText, stateLineColor, stateText } from "@/lib/tripTheme";
import type { ScheduleType } from "@/data/trainSchedules";
import type { FerryConnection } from "@/types/smartSchedule";
import { GutterRow } from "./GutterRow";
import { TimeDisplay } from "./TimeDisplay";
import { WalkIcon } from "./icons/WalkIcon";

interface FerryLegProps {
  ferry: FerryConnection;
  /** SF → Larkspur, ahead of the train; otherwise Larkspur → SF after it. */
  inbound?: boolean;
  /** Live-aware train time at Larkspur: its departure for an inbound ferry,
   *  its arrival for an outbound one. */
  trainTime: string;
  scheduleType: ScheduleType;
  timeFormat: "12h" | "24h";
}

/**
 * The Larkspur ↔ San Francisco ferry leg of a trip, laid out on the stop
 * timeline's gutter. Collapsed it reads as a one-line summary; expanded it
 * lists both terminals (with the Ferry Building gate), the ride, the walk to or
 * from the train, and the neighbouring run on the ferry timetable.
 */
export function FerryLeg({
  ferry,
  inbound = false,
  trainTime,
  scheduleType,
  timeFormat,
}: FerryLegProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();

  const transferMinutes = inbound
    ? calculateTimeDifference(ferry.arrive, trainTime)
    : calculateTimeDifference(trainTime, ferry.depart);
  const rideMinutes = calculateTimeDifference(ferry.depart, ferry.arrive);
  const alternative = adjacentFerry(ferry, inbound, scheduleType);

  const sfStop = (
    <TerminalName
      name={t("ferry.sfTerminal")}
      detail={ferry.sfGate ? t("ferry.gate", { gate: ferry.sfGate }) : null}
    />
  );
  const larkspurStop = <TerminalName name={t("ferry.larkspurTerminal")} />;
  const walkRow = (
    <LegRow
      above="dashed"
      below="dashed"
      aside={<WalkIcon className="h-4 w-4 text-muted-foreground" />}
    >
      <Transfer minutes={transferMinutes} />
    </LegRow>
  );

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={detailsId}
        className="flex w-full items-center gap-3 rounded-lg py-1.5 text-left transition-colors hover:bg-muted/50"
      >
        <div className="flex w-[5rem] shrink-0">
          <div className="w-8 shrink-0" />
          <div className="flex flex-1 justify-center">
            <Ship className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold">
            {inbound ? t("ferry.fromSanFrancisco") : t("ferry.toSanFrancisco")}
          </p>
          {!expanded && (
            <>
              <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
                <TerminalTime
                  label={inbound ? t("ferry.sanFrancisco") : t("ferry.larkspur")}
                  time={ferry.depart}
                  format={timeFormat}
                />
                <span className="text-muted-foreground" aria-hidden="true">
                  →
                </span>
                <TerminalTime
                  label={inbound ? t("ferry.larkspur") : t("ferry.sanFrancisco")}
                  time={ferry.arrive}
                  format={timeFormat}
                />
              </p>
              <Transfer minutes={transferMinutes} />
            </>
          )}
        </div>
        <ChevronDown
          className={cn(
            "mr-3 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>

      {expanded && (
        <div id={detailsId}>
          {!inbound && walkRow}
          <LegRow above={inbound ? "none" : "dashed"} below="solid" marker>
            {inbound ? sfStop : larkspurStop}
            <TimeDisplay time={ferry.depart} format={timeFormat} className="text-sm" />
          </LegRow>
          <LegRow above="solid" below="solid">
            <span className="text-xs text-muted-foreground">
              {t("ferry.rideMinutes", { minutes: rideMinutes })}
            </span>
          </LegRow>
          <LegRow above="solid" below={inbound ? "dashed" : "none"} marker>
            {inbound ? larkspurStop : sfStop}
            <TimeDisplay time={ferry.arrive} format={timeFormat} className="text-sm" />
          </LegRow>
          {inbound && walkRow}

          <div className="space-y-1 pt-2 text-xs text-muted-foreground">
            {(alternative || !inbound) && (
              <GutterRow>
                <span>
                  {alternative ? (
                    <>
                      {inbound ? t("ferry.earlierFerry") : t("ferry.nextFerry")}{" "}
                      <span className="whitespace-nowrap">
                        <TimeDisplay time={alternative.depart} format={timeFormat} />
                        {" → "}
                        <TimeDisplay time={alternative.arrive} format={timeFormat} />
                      </span>
                      {inbound && (
                        <span className="whitespace-nowrap">
                          {" · "}
                          {calculateTimeDifference(alternative.arrive, trainTime)}{" "}
                          {t("ferry.minTransfer")}
                        </span>
                      )}
                    </>
                  ) : (
                    t("ferry.lastFerry")
                  )}
                </span>
              </GutterRow>
            )}
            <GutterRow>
              <a
                href={FERRY_CONSTANTS.SCHEDULE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-foreground underline-offset-2 hover:text-primary hover:underline"
              >
                {t("ferry.goldenGateSchedule")}
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            </GutterRow>
          </div>
        </div>
      )}
    </div>
  );
}

type Connector = "none" | "solid" | "dashed";

/** One row on the stop timeline's two-column grid: the 5rem icon gutter (an
 *  optional side glyph, then the dot and its connectors) and the content. */
function LegRow({
  above,
  below,
  marker = false,
  aside,
  children,
}: {
  above: Connector;
  below: Connector;
  marker?: boolean;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex w-[5rem] shrink-0 self-stretch">
        <div className="flex w-8 shrink-0 items-center justify-end">{aside}</div>
        <div className="flex flex-1 flex-col items-center">
          <ConnectorLine kind={above} />
          {marker && (
            <Circle
              className={cn("h-2.5 w-2.5 shrink-0 fill-transparent", stateIconText.future)}
            />
          )}
          <ConnectorLine kind={below} />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-3">
        {children}
      </div>
    </div>
  );
}

function ConnectorLine({ kind }: { kind: Connector }) {
  return (
    <div
      className={cn(
        "flex-1",
        kind === "solid" && cn("w-px", stateLineColor.future),
        kind === "dashed" && "border-l border-dashed border-foreground/40",
        kind === "none" && "invisible",
      )}
      style={{ minHeight: 6 }}
    />
  );
}

function TerminalName({ name, detail }: { name: string; detail?: string | null }) {
  return (
    <span className="min-w-0 flex-1 text-sm">
      {name}
      {detail && (
        <span className="block text-xs font-medium text-muted-foreground">
          {detail}
        </span>
      )}
    </span>
  );
}

function TerminalTime({
  label,
  time,
  format,
}: {
  label: string;
  time: string;
  format: "12h" | "24h";
}) {
  return (
    <span className="flex items-baseline gap-1 whitespace-nowrap">
      <span className="text-[10px] uppercase text-muted-foreground">{label}</span>
      <TimeDisplay time={time} format={format} />
    </span>
  );
}

function Transfer({ minutes }: { minutes: number }) {
  const { t } = useTranslation();
  const tight = isQuickConnection(minutes);
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-xs text-muted-foreground",
        tight && cn(stateText.delayed, "font-medium"),
      )}
    >
      {tight ? (
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      ) : (
        <Clock className="h-3 w-3" aria-hidden="true" />
      )}
      {minutes} {t("ferry.minTransfer")}
    </span>
  );
}
