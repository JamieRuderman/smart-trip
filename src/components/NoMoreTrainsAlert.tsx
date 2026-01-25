import { AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

export function NoMoreTrainsAlert() {
  const { t } = useTranslation();

  return (
    <div
      className="mb-3 p-3 bg-smart-gold/10 border border-smart-gold/20 rounded-lg"
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <AlertCircle className="h-4 w-4 text-smart-gold" aria-hidden="true" />
        <p className="text-smart-gold font-medium">
          {t("noMoreTrains.noMoreTrainsToday")}
        </p>
      </div>
      <p className="text-sm text-smart-gold/80 mt-1 ml-6">
        {t("noMoreTrains.allTrainsDeparted")}
      </p>
    </div>
  );
}
