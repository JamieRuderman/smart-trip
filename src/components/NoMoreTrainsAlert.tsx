import { AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

export function NoMoreTrainsAlert() {
  const { t } = useTranslation();

  return (
    <Alert variant="warning" aria-live="polite" className="mb-3">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>{t("noMoreTrains.noMoreTrainsToday")}</AlertTitle>
      <AlertDescription>{t("noMoreTrains.allTrainsDeparted")}</AlertDescription>
    </Alert>
  );
}
