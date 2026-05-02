import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import {
  useScheduleFreshness,
  type ScheduleFreshness,
} from "@/hooks/useScheduleFreshness";
import { cn } from "@/lib/utils";

function freshnessText(t: TFunction, freshness: ScheduleFreshness): string {
  const { ageDays, severity, source } = freshness;
  if (ageDays === null) return t("bottomInfo.scheduleUpdatedUnknown");
  const base =
    ageDays === 0
      ? t("bottomInfo.scheduleUpdatedToday")
      : ageDays === 1
        ? t("bottomInfo.scheduleUpdatedYesterday")
        : t("bottomInfo.scheduleUpdatedDaysAgo", { count: ageDays });
  if (source === "bundled") {
    return `${base}. ${t("bottomInfo.scheduleBundledHint")}`;
  }
  if (severity !== "fresh") {
    return `${base}. ${t("bottomInfo.scheduleStaleSuffix")}`;
  }
  return base;
}

interface ScheduleFreshnessLabelProps {
  className?: string;
}

/**
 * Footer text that surfaces how recently the schedule data was refreshed.
 * Quiet when fresh, gold when warn (>7 days or bundled-only fallback), red
 * when stale (>30 days). Always visible — users should know what era the
 * timetable they're seeing comes from.
 */
export function ScheduleFreshnessLabel({ className }: ScheduleFreshnessLabelProps) {
  const { t } = useTranslation();
  const freshness = useScheduleFreshness();
  const text = freshnessText(t, freshness);

  const colorClass =
    freshness.severity === "stale"
      ? "text-destructive"
      : freshness.severity === "warn"
        ? "text-smart-gold"
        : "text-muted-foreground";

  const showIcon = freshness.severity !== "fresh";

  return (
    <p
      className={cn("text-xs flex items-center gap-1.5", colorClass, className)}
      role={freshness.severity === "stale" ? "alert" : undefined}
    >
      {showIcon && (
        <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
      )}
      <span>{text}</span>
    </p>
  );
}
