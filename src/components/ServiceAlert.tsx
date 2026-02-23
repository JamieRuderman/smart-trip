import staticServiceAlerts from "@/data/serviceAlerts";
import type { ServiceAlertData } from "@/types/smartSchedule";
import { useDismissedAlerts } from "@/hooks/useDismissedAlerts";
import { AlertTriangle, X } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { SectionCard } from "@/components/ui/section-card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

interface ServiceAlertProps {
  /** Live alerts from GTFS-RT. Falls back to static data when not provided. */
  alerts?: ServiceAlertData[];
}

export function ServiceAlert({ alerts }: ServiceAlertProps) {
  const { t } = useTranslation();
  const { isDismissed, dismissAlert, restoreAll, dismissedCountForActive, pruneExpired } =
    useDismissedAlerts();
  const now = new Date();

  // For static fallback data only — live alerts are pre-filtered by useServiceAlerts
  const isStaticAlertActive = (alert: ServiceAlertData) => {
    if (alert.active === false) return false;
    const startsOk = alert.startsAt ? new Date(alert.startsAt) <= now : true;
    const endsOk = alert.endsAt ? now <= new Date(alert.endsAt) : true;
    return startsOk && endsOk;
  };

  // Live alerts are already filtered; static data needs the active check
  const activeAlerts = alerts ?? staticServiceAlerts.filter(isStaticAlertActive);

  useEffect(() => {
    pruneExpired();
  }, [pruneExpired, alerts]);

  if (activeAlerts.length === 0) {
    return null;
  }

  const visibleAlerts = activeAlerts.filter((alert) => !isDismissed(alert));
  const dismissedActiveCount = dismissedCountForActive(activeAlerts);

  // All dismissed — show a subtle restore hint
  if (visibleAlerts.length === 0) {
    return (
      <div className="flex items-center gap-1.5 px-1 py-0.5 text-xs text-muted-foreground">
        <AlertTriangle className="h-3 w-3 shrink-0" />
        <span>
          {t("serviceAlert.dismissedNotice", { count: dismissedActiveCount })}{" "}
          <button
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
    <SectionCard>
      <CardHeader className="p-3 md:p-6">
        <CardTitle className="flex items-center gap-2">
          <span>{t("serviceAlert.sectionTitle")}</span>
          <span className="text-xs font-semibold bg-smart-gold/20 text-smart-gold px-2 py-0.5 rounded-full">
            {activeAlerts.length}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-6 pt-0 md:pt-0 space-y-2">
        {visibleAlerts.map((alert) => (
          <Alert key={alert.fingerprint} variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                {alert.startsAt && (
                  <p className="text-xs text-smart-gold/60 md:hidden mb-0.5">
                    {new Date(alert.startsAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <AlertTitle className="flex-1 mb-0">
                    {alert.title ?? t("serviceAlert.sectionTitle")}
                  </AlertTitle>
                  {alert.startsAt && (
                    <p className="hidden md:block shrink-0 text-xs text-smart-gold/60">
                      {new Date(alert.startsAt).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  )}
                </div>
                {alert.message && (
                  <AlertDescription className="text-smart-gold/80 space-y-0.5">
                    <p>{alert.message}</p>
                  </AlertDescription>
                )}
              </div>
              <button
                aria-label={t("serviceAlert.dismiss")}
                onClick={() => dismissAlert(alert)}
                className="shrink-0 mt-0.5 text-smart-gold/60 hover:text-smart-gold transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </Alert>
        ))}
      </CardContent>
    </SectionCard>
  );
}
