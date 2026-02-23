import staticServiceAlerts from "@/data/serviceAlerts";
import type { ServiceAlertData } from "@/types/smartSchedule";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

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

  return (
    <Card className="border-0 shadow-none md:border md:shadow-sm max-w-4xl mx-auto w-full">
      <CardHeader className="p-3 md:p-6">
        <CardTitle className="flex items-center gap-2">
          <span>{t("serviceAlert.sectionTitle")}</span>
          <span className="text-xs font-semibold bg-smart-gold/20 text-smart-gold px-2 py-0.5 rounded-full">
            {activeAlerts.length}
          </span>
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          className="!mt-6"
          onClick={onToggleServiceAlert}
        >
          {showServiceAlert
            ? t("serviceAlert.hideServiceAlert")
            : t("serviceAlert.serviceAlert")}
        </Button>
      </CardHeader>

      {showServiceAlert && (
        <CardContent className="p-3 md:p-6 pt-0 md:pt-0 space-y-2">
          {activeAlerts.map((alert) => (
            <Alert key={alert.id} variant="warning">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>
                {alert.title ?? t("serviceAlert.sectionTitle")}
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
        </CardContent>
      )}
    </Card>
  );
}
