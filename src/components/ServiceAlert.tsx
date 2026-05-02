import type { ServiceAlertData } from "@/types/smartSchedule";
import { useDismissedAlerts } from "@/hooks/useDismissedAlerts";
import { AlertTriangle, X } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/ui/section-card";

interface ServiceAlertProps {
  /** Live alerts from GTFS-RT — already filtered by `useServiceAlerts`. */
  alerts: ServiceAlertData[];
}

export function ServiceAlert({ alerts }: ServiceAlertProps) {
  const { t } = useTranslation();
  const { isDismissed, dismissAlert, restoreAll, dismissedCountForActive, pruneExpired } =
    useDismissedAlerts();

  const activeAlerts = alerts;

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
      <div className="flex items-center gap-1.5 px-4 py-0.5 pt-4 md:pt-1 text-xs text-muted-foreground max-w-4xl mx-auto w-full">
        <AlertTriangle className="h-3 w-3 shrink-0" />
        <span>
          {t("serviceAlert.dismissedNotice", { count: dismissedActiveCount })}{" "}
          <button
            type="button"
            onClick={restoreAll}
            className="underline underline-offset-2 hover:text-foreground"
          >
            {t("serviceAlert.restore")}
          </button>
        </span>
      </div>
    );
  }

  return (
    <>
      {visibleAlerts.map((alert) => (
        <SectionCard
          key={alert.fingerprint}
          className="overflow-hidden bg-smart-gold/5 md:border-smart-gold/30"
        >
          <div className="w-full px-5 py-4 md:px-6 flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 flex-1 min-w-0">
              <AlertTriangle className="h-5 w-5 text-smart-gold flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-sm text-smart-gold">
                    {alert.title ?? t("serviceAlert.sectionTitle")}
                  </div>
                  {alert.startsAt && (
                    <p className="shrink-0 text-xs text-smart-gold/60">
                      {new Date(alert.startsAt).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  )}
                </div>
                {alert.message && (
                  <p className="text-xs text-smart-gold/80 mt-1">{alert.message}</p>
                )}
              </div>
            </div>
            <button
              type="button"
              aria-label={t("serviceAlert.dismiss")}
              onClick={() => dismissAlert(alert)}
              className="shrink-0 -mr-2 -mt-2 -mb-2 p-3 rounded-lg text-smart-gold/70 hover:text-smart-gold hover:bg-smart-gold/10 active:bg-smart-gold/20 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </SectionCard>
      ))}
    </>
  );
}
