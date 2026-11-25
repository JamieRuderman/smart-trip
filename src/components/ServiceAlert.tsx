import type { ServiceAlertData } from "@/types/smartSchedule";
import { useDismissedAlerts } from "@/hooks/useDismissedAlerts";
import { AlertTriangle, ChevronDown, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/ui/section-card";
import { formatStartedLabel, parseDateOrInstant } from "@/lib/timeUtils";

interface ServiceAlertProps {
  /** Live alerts from GTFS-RT — already filtered by `useServiceAlerts`. */
  alerts: ServiceAlertData[];
}

export function ServiceAlert({ alerts }: ServiceAlertProps) {
  const { t, i18n } = useTranslation();
  const { isDismissed, dismissAlert, restoreAll, dismissedCountForActive, pruneExpired } =
    useDismissedAlerts();

  const activeAlerts = alerts;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggleExpanded = (fingerprint: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(fingerprint)) next.add(fingerprint);
      return next;
    });

  useEffect(() => {
    pruneExpired();
  }, [pruneExpired, alerts]);

  if (activeAlerts.length === 0) {
    return null;
  }

  const visibleAlerts = activeAlerts.filter((alert) => !isDismissed(alert));
  const dismissedActiveCount = dismissedCountForActive(activeAlerts);

  // All dismissed — show a subtle neutral restore hint
  if (visibleAlerts.length === 0) {
    return (
      <div className="flex items-center gap-1.5 px-4 py-0.5 text-xs text-muted-foreground max-w-4xl mx-auto w-full">
        <AlertTriangle className="h-3 w-3 shrink-0" />
        <span>
          {t("serviceAlert.dismissedNotice", { count: dismissedActiveCount })}{" "}
          <button
            type="button"
            onClick={restoreAll}
            className="text-foreground underline-offset-2 hover:underline"
          >
            {t("serviceAlert.restore")}
          </button>
        </span>
      </div>
    );
  }

  return (
    <>
      {visibleAlerts.map((alert) => {
        const startedAt = alert.startsAt ? parseDateOrInstant(alert.startsAt) : NaN;
        const isExpanded = expanded.has(alert.fingerprint);
        const since = Number.isFinite(startedAt) && (
          <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide opacity-70">
            {t("serviceAlert.since", {
              date: formatStartedLabel(startedAt, Date.now(), "12h", i18n.language),
            })}
          </p>
        );
        return (
          <SectionCard
            key={alert.fingerprint}
            className="overflow-hidden bg-smart-gold/5 md:border-smart-gold/30"
          >
            <div className="w-full px-5 py-4 md:px-6 flex items-start justify-between text-smart-gold-foreground">
              <div className="flex items-start gap-2.5 flex-1 min-w-0">
                <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                <button
                  type="button"
                  onClick={() => toggleExpanded(alert.fingerprint)}
                  disabled={!alert.message}
                  aria-expanded={alert.message ? isExpanded : undefined}
                  className="flex-1 min-w-0 break-words text-left"
                >
                  <div className="font-semibold text-sm">
                    {alert.title ?? t("serviceAlert.sectionTitle")}
                  </div>
                  {(!alert.message || isExpanded) && since}
                  {alert.message && isExpanded && (
                    <p className="text-xs mt-1 pr-1 max-h-64 overflow-y-auto overscroll-contain">
                      {alert.message}
                    </p>
                  )}
                  {alert.message && (
                    <span className="mt-1 inline-flex items-center gap-0.5 text-xs">
                      {t(isExpanded ? "serviceAlert.showLess" : "serviceAlert.showMore")}
                      <ChevronDown
                        className={cn("h-3.5 w-3.5 transition-transform", isExpanded && "rotate-180")}
                        aria-hidden="true"
                      />
                    </span>
                  )}
                </button>
              </div>
              <button
                type="button"
                aria-label={t("serviceAlert.dismiss")}
                onClick={() => dismissAlert(alert)}
                className="shrink-0 -mr-2 -mt-2 p-3 rounded-lg hover:bg-smart-gold/10 active:bg-smart-gold/20 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </SectionCard>
        );
      })}
    </>
  );
}
