import staticServiceAlerts from "@/data/serviceAlerts";
import type { ServiceAlertData } from "@/types/smartSchedule";
import { AlertCircle, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "./ui/button";

interface ServiceAlertProps {
  showServiceAlert: boolean;
  onToggleServiceAlert: () => void;
  /** Live alerts from GTFS-RT. Falls back to static data when not provided. */
  alerts?: ServiceAlertData[];
}

export function ServiceAlert({
  showServiceAlert,
  onToggleServiceAlert,
  alerts,
}: ServiceAlertProps) {
  const { t } = useTranslation();
  const now = new Date();

  // For static fallback data only — live alerts are pre-filtered by useServiceAlerts
  const isStaticAlertActive = (alert: ServiceAlertData) => {
    if (alert.active === false) return false;
    const startsOk = alert.startsAt ? new Date(alert.startsAt) <= now : true;
    const endsOk = alert.endsAt ? now <= new Date(alert.endsAt) : true;
    return startsOk && endsOk;
  };

  // Live alerts are already filtered; static data needs the active check
  const activeAlerts =
    alerts ?? staticServiceAlerts.filter(isStaticAlertActive);
  if (activeAlerts.length === 0) {
    return null;
  }

  if (showServiceAlert) {
    return (
      <div className="max-w-4xl mx-auto w-full space-y-2">
        {activeAlerts.map((alert) => (
          <Alert key={alert.id} variant="warning" className="relative">
            <button
              className="absolute top-3 right-3 p-1 rounded hover:bg-smart-gold/20 transition-colors"
              onClick={onToggleServiceAlert}
              aria-label={t("serviceAlert.hideServiceAlert")}
            >
              <X className="h-4 w-4" />
            </button>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle className="pr-6">
              {alert.title ?? t("serviceAlert.serviceAlert")}
            </AlertTitle>
            {(alert.message || alert.startsAt) && (
              <AlertDescription className="text-smart-gold/80 space-y-0.5">
                {alert.message && <p>{alert.message}</p>}
                {alert.startsAt && (
                  <p className="text-xs text-smart-gold/60">
                    {t("serviceAlert.issuedAt", {
                      time: new Date(alert.startsAt).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      }),
                    })}
                  </p>
                )}
              </AlertDescription>
            )}
          </Alert>
        ))}
      </div>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="max-w-4xl mx-auto w-full border-smart-gold text-smart-gold hover:text-smart-gold-foreground bg-smart-gold/10 hover:bg-smart-gold/20"
      onClick={onToggleServiceAlert}
      aria-label={t("serviceAlert.serviceAlert")}
    >
      <span>{t("serviceAlert.serviceAlert")}</span>
    </Button>
  );
}
