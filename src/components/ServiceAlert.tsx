import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, X, ChevronDown } from "lucide-react";
import serviceAlerts from "@/data/serviceAlerts";
import type { ServiceAlertData } from "@/types/smartSchedule";
import { useTranslation } from "react-i18next";

interface ServiceAlertProps {
  showServiceAlert: boolean;
  onToggleServiceAlert: () => void;
}

export function ServiceAlert({
  showServiceAlert,
  onToggleServiceAlert,
}: ServiceAlertProps) {
  const { t } = useTranslation();
  const now = new Date();

  const isAlertActive = (alert: ServiceAlertData) => {
    if (alert.active === false) return false;
    const startsOk = alert.startsAt ? new Date(alert.startsAt) <= now : true;
    const endsOk = alert.endsAt ? now <= new Date(alert.endsAt) : true;
    return startsOk && endsOk && (alert.active ?? true);
  };

  const activeAlerts = serviceAlerts.filter(isAlertActive);
  if (activeAlerts.length === 0) {
    return null;
  }

  if (showServiceAlert) {
    return (
      <Card className="ring-2 ring-smart-gold/50 bg-smart-gold/5 border border-smart-gold rounded-lg md:rounded-lg max-w-4xl mx-auto">
        <CardContent className="p-6 relative">
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-2 right-2 h-8 w-8 p-0 hover:bg-smart-gold/10"
            onClick={onToggleServiceAlert}
            aria-label={t("serviceAlert.hideServiceAlert")}
          >
            <X className="h-4 w-4 text-smart-gold" />
          </Button>
          {activeAlerts.map((alert) => (
            <div key={alert.id} className="flex items-start gap-3 pr-8">
              <AlertCircle className="h-4 w-4 text-smart-gold mt-1 flex-shrink-0" />
              <div>
                <p className="font-medium text-smart-gold">
                  {alert.title ?? t("serviceAlert.serviceAlert")}
                </p>
                <p className="text-sm text-muted-foreground">{alert.message}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="max-w-4xl mx-auto flex justify-center w-full">
      <Button
        variant="outline"
        size="sm"
        className="w-full justify-start font-medium gap-2 border border-smart-gold ring-2 ring-smart-gold/50 bg-smart-gold/5 text-smart-gold hover:bg-smart-gold/10 hover:text-smart-gold hover:border-smart-gold hover:ring-smart-gold/50"
        onClick={onToggleServiceAlert}
      >
        <AlertCircle className="h-6 w-6 text-smart-gold flex-shrink-0" />
        {t("serviceAlert.serviceAlert")}
        <ChevronDown className="h-4 w-4 text-smart-gold ml-auto" />
      </Button>
    </div>
  );
}
